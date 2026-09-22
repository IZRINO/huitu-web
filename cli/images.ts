import { readFile, stat, copyFile, mkdir, writeFile, rename, rm } from 'node:fs/promises'
import { join, basename } from 'node:path'
import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import type { ImagePayload } from '../src/lib/api.js'
import { CliError } from './types.js'

export function imageFormat(bytes: Uint8Array): 'png' | 'jpg' | 'webp' {
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (b.length >= 24 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'png'
  if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) return 'jpg'
  if (b.length >= 12 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') return 'webp'
  throw new CliError('File is not a PNG, JPEG or WebP image')
}
export async function checkInput(path: string, mask = false) {
  const info = await stat(path).catch(() => { throw new CliError(`Cannot read image: ${path}`) })
  if (!info.isFile() || info.size > 50 * 1024 * 1024) throw new CliError(`Image must be a file no larger than 50 MiB: ${path}`)
  const bytes = await readFile(path)
  const format = imageFormat(bytes)
  if (mask && format !== 'png') throw new CliError('Mask must be PNG')
  return format
}
export async function stageInputs(dir: string, images: string[], mask?: string) {
  const inputs = join(dir, 'inputs')
  await mkdir(inputs, { recursive: true, mode: 0o700 })
  const paths: string[] = []
  for (const [index, path] of images.entries()) {
    const ext = await checkInput(path)
    const target = join(inputs, `${index + 1}.${ext}`)
    await copyFile(path, target)
    await checkInput(target)
    paths.push(target)
  }
  let maskPath: string | undefined
  if (mask) { await checkInput(mask, true); maskPath = join(inputs, 'mask.png'); await copyFile(mask, maskPath); await checkInput(maskPath, true) }
  return { images: paths, mask: maskPath }
}
export async function imageFile(path: string) {
  const bytes = await readFile(path), format = imageFormat(bytes)
  return new File([bytes], basename(path), { type: `image/${format === 'jpg' ? 'jpeg' : format}` })
}
function decode(raw: string) {
  const payload = raw.startsWith('data:') ? /^data:image\/[\w.+-]+;base64,([\s\S]+)$/.exec(raw)?.[1] : raw
  if (!payload) throw new Error('Invalid image data URL')
  const cleaned = payload.replace(/\s/g, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(cleaned) || cleaned.length % 4 === 1) throw new Error('Invalid base64 image')
  return Buffer.from(cleaned, 'base64')
}
async function obtain(image: ImagePayload, signal: AbortSignal, timeout: number) {
  if (image.b64_json || image.result) return decode(image.b64_json || image.result!)
  if (!image.url) throw new Error('Missing image data')
  if (image.url.startsWith('data:')) return decode(image.url)
  const url = new URL(image.url)
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid result URL')
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(timeout * 1000)]) })
  if (!response.ok) throw new Error(`Image download HTTP ${response.status}`)
  return Buffer.from(await response.arrayBuffer())
}
export async function downloadImage(image: ImagePayload, dir: string, index: number, signal: AbortSignal, timeout: number) {
  await mkdir(dir, { recursive: true })
  let last: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    try {
      const bytes = await obtain(image, signal, timeout)
      const ext = imageFormat(bytes)
      const target = join(dir, `${String(index + 1).padStart(2, '0')}.${ext}`)
      const temp = `${target}.${randomUUID()}.part`
      try {
        await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
        signal.throwIfAborted()
        await rename(temp, target)
      } finally { await rm(temp, { force: true }) }
      return target
    } catch (error) { last = error; if (attempt < 2) await delay(1000 * (attempt + 1), undefined, { signal }) }
  }
  throw last
}
