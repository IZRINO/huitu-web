export function uid() {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
export function mimeOf(format) {
    if (format === 'jpeg')
        return 'image/jpeg';
    if (format === 'webp')
        return 'image/webp';
    return 'image/png';
}
export function extOf(format) {
    if (format === 'jpeg')
        return 'jpg';
    if (format === 'webp')
        return 'webp';
    return 'png';
}
export function b64ToDataUrl(b64, format) {
    if (b64.startsWith('data:'))
        return b64;
    return `data:${mimeOf(format)};base64,${b64}`;
}
export function dataUrlToBlob(dataUrl) {
    const [head, body] = dataUrl.split(',');
    const mime = /data:([^;]+)/.exec(head)?.[1] ?? 'image/png';
    const bin = atob(body);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
}
export async function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
    });
}
export function stampName(prefix, size, format) {
    const t = new Date();
    const p = [
        t.getFullYear(),
        String(t.getMonth() + 1).padStart(2, '0'),
        String(t.getDate()).padStart(2, '0'),
        '-',
        String(t.getHours()).padStart(2, '0'),
        String(t.getMinutes()).padStart(2, '0'),
        String(t.getSeconds()).padStart(2, '0'),
    ].join('');
    return `${prefix}-${p}-${size}.${extOf(format)}`;
}
export function estimateCost(usage) {
    if (!usage)
        return null;
    const textIn = usage.input_tokens_details?.text_tokens ?? 0;
    const imageIn = usage.input_tokens_details?.image_tokens ?? 0;
    const out = usage.output_tokens ?? 0;
    const usd = (textIn / 1e6) * 5 + (imageIn / 1e6) * 8 + (out / 1e6) * 30;
    if (usd <= 0 && !usage.total_tokens)
        return null;
    return `$${usd.toFixed(4)}`;
}
export function usageLine(usage) {
    if (!usage)
        return null;
    const parts = [];
    if (usage.input_tokens != null)
        parts.push(`入 ${usage.input_tokens}`);
    if (usage.output_tokens != null)
        parts.push(`出 ${usage.output_tokens}`);
    const cost = estimateCost(usage);
    if (cost)
        parts.push(cost);
    return parts.length ? parts.join(' · ') : null;
}
export function joinUrl(base, path) {
    return `${base.replace(/\/+$/, '')}${path}`;
}
export function fileOk(file) {
    const type = file.type.toLowerCase();
    if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(type)) {
        return `${file.name} 只要 png / jpg / webp`;
    }
    if (file.size > 50 * 1024 * 1024)
        return `${file.name} 超过 50MB`;
    return null;
}
