import { describeHttp } from './errors.js';
import { b64ToDataUrl, blobToDataUrl, joinUrl } from './format.js';
export function parseExtra(raw) {
    if (!raw.trim())
        return {};
    const obj = JSON.parse(raw);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        throw new Error('额外请求头必须是 JSON 对象');
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        if (typeof v !== 'string')
            throw new Error('Extra header values must be strings');
        out[k] = v;
    }
    return out;
}
export async function relayFetch(settings, target, init) {
    const extra = parseExtra(settings.extraHeaders);
    if (settings.useProxy) {
        const headers = new Headers(init.headers);
        headers.set('x-relay-url', target);
        if (settings.organization)
            headers.set('x-relay-organization', settings.organization);
        if (Object.keys(extra).length)
            headers.set('x-relay-headers', JSON.stringify(extra));
        return fetch(settings.relayUrl || '/api/relay', { ...init, headers });
    }
    const headers = new Headers(init.headers);
    for (const [k, v] of Object.entries(extra))
        headers.set(k, v);
    if (settings.organization)
        headers.set('OpenAI-Organization', settings.organization);
    return fetch(target, { ...init, headers });
}
export function authHeaders(apiKey, json = false) {
    const h = new Headers();
    if (json)
        h.set('Content-Type', 'application/json');
    if (apiKey)
        h.set('Authorization', `Bearer ${apiKey}`);
    return h;
}
async function urlToDataUrl(url) {
    if (url.startsWith('data:'))
        return url;
    const res = await fetch(url);
    if (!res.ok)
        throw new Error('结果地址下载失败');
    return blobToDataUrl(await res.blob());
}
async function collectImages(data, format) {
    const images = [];
    for (const item of data) {
        if (item.b64_json)
            images.push({ dataUrl: b64ToDataUrl(item.b64_json, format), b64: item.b64_json });
        else if (item.result)
            images.push({ dataUrl: b64ToDataUrl(item.result, format), b64: item.result });
        else if (item.url)
            images.push({ dataUrl: await urlToDataUrl(item.url) });
    }
    if (!images.length)
        throw new Error('中转站没有返回图片');
    return images;
}
async function readSse(res, format, onPartial) {
    if (!res.body)
        throw new Error('没有流');
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const result = { data: [] };
    const completed = new Map();
    const pushEvent = async (block) => {
        const lines = block.split('\n');
        let event = 'message';
        const dataLines = [];
        for (const line of lines) {
            if (line.startsWith('event:'))
                event = line.slice(6).trim();
            else if (line.startsWith('data:'))
                dataLines.push(line.slice(5).trim());
        }
        if (!dataLines.length)
            return;
        const raw = dataLines.join('\n');
        if (raw === '[DONE]')
            return;
        let json;
        try {
            json = JSON.parse(raw);
        }
        catch {
            throw new Error('Invalid JSON in image stream');
        }
        const b64 = (json.b64_json ?? json.result);
        if (typeof json.type === 'string')
            event = json.type;
        if (json.error) {
            const err = json.error;
            throw new Error(err.message || 'Image stream failed');
        }
        if (json.usage)
            result.usage = json.usage;
        for (const key of ['size', 'quality', 'background', 'output_format']) {
            if (typeof json[key] === 'string')
                result[key] = json[key];
        }
        if (typeof b64 === 'string' && onPartial && event.includes('partial')) {
            onPartial(b64ToDataUrl(b64, format));
        }
        if (event.includes('partial'))
            return;
        if (Array.isArray(json.data))
            result.data = json.data;
        else if (typeof b64 === 'string') {
            const index = json.output_index ?? json.image_index;
            completed.set(index == null ? b64 : String(index), { b64_json: b64 });
        }
    };
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split(/\r?\n\r?\n/);
        buf = parts.pop() ?? '';
        for (const part of parts) {
            if (part.trim())
                await pushEvent(part);
        }
    }
    buf += decoder.decode();
    if (buf.trim())
        await pushEvent(buf);
    if (!result.data?.length)
        result.data = [...completed.values()];
    if (!result.data.length)
        throw new Error('流结束但没有成片');
    return result;
}
export async function parseResponse(res, format, stream, onPartial) {
    const ct = res.headers.get('content-type') ?? '';
    if (!res.ok) {
        const text = await res.text();
        throw new Error(describeHttp(res.status, text));
    }
    if (stream && (ct.includes('text/event-stream') || ct.includes('text/plain'))) {
        const payload = await readSse(res, format, onPartial);
        return payload;
    }
    const payload = (await res.json());
    if (payload.error?.message)
        throw new Error(payload.error.message);
    if (!Array.isArray(payload.data) || !payload.data.length)
        throw new Error('No images returned');
    return payload;
}
async function browserResult(payload, format) {
    return {
        images: await collectImages(payload.data ?? [], format),
        usage: payload.usage,
        size: payload.size,
        quality: payload.quality,
        background: payload.background,
        outputFormat: payload.output_format,
    };
}
export async function requestImages(settings, body, handlers) {
    if (!settings.baseUrl.trim())
        throw new Error('先填中转站地址');
    if (!settings.apiKey.trim())
        throw new Error('先填密钥');
    const payload = {
        model: body.model,
        prompt: body.prompt,
        n: body.n,
        size: body.size,
        quality: body.quality,
        background: body.background,
        output_format: body.output_format,
        moderation: body.moderation,
        stream: body.stream,
    };
    if (body.output_format !== 'png')
        payload.output_compression = body.output_compression;
    if (body.stream)
        payload.partial_images = body.partial_images ?? 2;
    const editing = 'images' in body;
    let form;
    if (editing) {
        if (!body.images.length)
            throw new Error('At least one reference image is required');
        form = new FormData();
        for (const [key, value] of Object.entries(payload))
            form.append(key, String(value));
        form.append('input_fidelity', body.input_fidelity);
        for (const file of body.images)
            form.append('image', file);
        if (body.mask)
            form.append('mask', body.mask, 'mask.png');
    }
    const res = await relayFetch(settings, joinUrl(settings.baseUrl, editing ? '/images/edits' : '/images/generations'), {
        method: 'POST',
        headers: authHeaders(settings.apiKey, !editing),
        body: form ?? JSON.stringify(payload),
        signal: handlers.signal,
    });
    return parseResponse(res, body.output_format, body.stream, handlers.onPartial);
}
export async function generateImage(settings, body, handlers) {
    return browserResult(await requestImages(settings, body, handlers), body.output_format);
}
export async function editImage(settings, body, handlers) {
    return browserResult(await requestImages(settings, body, handlers), body.output_format);
}
export async function testRelay(settings) {
    if (!settings.baseUrl.trim())
        throw new Error('先填中转站地址');
    if (!settings.apiKey.trim())
        throw new Error('先填密钥');
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 12000);
    try {
        const res = await relayFetch(settings, joinUrl(settings.baseUrl, '/models'), {
            method: 'GET',
            headers: authHeaders(settings.apiKey, false),
            signal: ctrl.signal,
        });
        if (res.status === 401)
            throw new Error('密钥被拒绝');
        if (res.status === 404)
            return '地址通了，该站没有模型列表，仍可出图';
        if (!res.ok) {
            const text = await res.text();
            throw new Error(describeHttp(res.status, text));
        }
        const json = (await res.json());
        const ids = json.data?.map((x) => x.id).filter(Boolean) ?? [];
        if (ids.some((id) => id?.includes('gpt-image'))) {
            return `已接通，模型列表含图像模型（${ids.length}）`;
        }
        return `已接通（${ids.length || '未列出'} 个模型）`;
    }
    finally {
        clearTimeout(timer);
    }
}
