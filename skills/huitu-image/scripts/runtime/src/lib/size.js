export const MIN_PIXELS = 655_360;
export const MAX_PIXELS = 8_294_400;
export const MAX_EDGE = 3840;
export const MAX_RATIO = 3;
export const ASPECTS = [
    { id: '1:1', w: 1, h: 1 },
    { id: '3:2', w: 3, h: 2 },
    { id: '2:3', w: 2, h: 3 },
    { id: '4:3', w: 4, h: 3 },
    { id: '3:4', w: 3, h: 4 },
    { id: '16:9', w: 16, h: 9 },
    { id: '9:16', w: 9, h: 16 },
    { id: '21:9', w: 21, h: 9 },
];
export const LONG_EDGES = [1024, 1536, 2048, 2560, 3840];
export const SIZE_PRESETS = [
    { id: 'auto', size: 'auto', label: '自动' },
    { id: '1024x1024', size: '1024x1024', label: '1024²' },
    { id: '1536x1024', size: '1536x1024', label: '横 1536' },
    { id: '1024x1536', size: '1024x1536', label: '竖 1024' },
    { id: '1920x1080', size: '1920x1080', label: 'FHD' },
    { id: '2048x2048', size: '2048x2048', label: '2048²' },
    { id: '2048x1152', size: '2048x1152', label: '2K 横' },
    { id: '2560x1440', size: '2560x1440', label: 'QHD' },
    { id: '3840x2160', size: '3840x2160', label: '4K 横' },
    { id: '2160x3840', size: '2160x3840', label: '4K 竖' },
];
export function snap16(n) {
    return Math.max(16, Math.round(n / 16) * 16);
}
export function sizeFromAspect(aspectId, longEdge) {
    const a = ASPECTS.find((x) => x.id === aspectId) ?? ASPECTS[0];
    const ratio = a.w / a.h;
    const minLong = Math.ceil(Math.sqrt(MIN_PIXELS * Math.max(ratio, 1 / ratio)));
    let long = snap16(Math.max(longEdge, minLong));
    long = Math.min(long, MAX_EDGE);
    if (a.w >= a.h) {
        const width = long;
        const height = snap16((long * a.h) / a.w);
        return `${width}x${height}`;
    }
    const height = long;
    const width = snap16((long * a.w) / a.h);
    return `${width}x${height}`;
}
export function parseSize(size) {
    if (size === 'auto')
        return null;
    const m = /^(\d+)x(\d+)$/.exec(size);
    if (!m)
        return null;
    return { w: Number(m[1]), h: Number(m[2]) };
}
export function validateSize(size) {
    if (size === 'auto')
        return { ok: true };
    const parsed = parseSize(size);
    if (!parsed)
        return { ok: false, message: '分辨率写成 宽x高，例如 1536x1024' };
    const { w, h } = parsed;
    if (w % 16 !== 0 || h % 16 !== 0)
        return { ok: false, message: '宽和高都必须是 16 的倍数' };
    if (w > MAX_EDGE || h > MAX_EDGE)
        return { ok: false, message: `长边不能超过 ${MAX_EDGE}` };
    if (w < 16 || h < 16)
        return { ok: false, message: '边长过短' };
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (ratio > MAX_RATIO + 1e-6)
        return { ok: false, message: '长宽比不能超过 3:1' };
    const px = w * h;
    if (px < MIN_PIXELS)
        return { ok: false, message: `总像素不能低于 ${MIN_PIXELS}` };
    if (px > MAX_PIXELS)
        return { ok: false, message: `总像素不能超过 ${MAX_PIXELS}` };
    return { ok: true, w, h };
}
export function resolveSize(p) {
    if (p.sizeMode === 'auto')
        return 'auto';
    if (p.sizeMode === 'preset')
        return p.sizePreset;
    if (p.sizeMode === 'aspect')
        return sizeFromAspect(p.aspect, p.longEdge);
    return `${snap16(p.customW)}x${snap16(p.customH)}`;
}
export function sheetRatio(size) {
    const parsed = parseSize(size);
    if (!parsed)
        return 1;
    return parsed.w / parsed.h;
}
