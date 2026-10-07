import { createReadStream } from 'node:fs'
import { stat, realpath } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, join, resolve, relative, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { handleRelay, publicRelay } from './server/relay.mjs'

const root = resolve(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const port = Number(process.env.PORT || 4173)
const host = process.env.HOST || '127.0.0.1'
if (!['127.0.0.1', '::1', 'localhost'].includes(host) && !process.env.HUITU_RELAY_TOKEN && !publicRelay) throw new Error('Network access requires HUITU_RELAY_TOKEN or explicit HUITU_RELAY_PUBLIC=true')

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2', '.woff': 'font/woff',
}

function inside(path) {
  const child = relative(root, path)
  return !isAbsolute(child) && child !== '..' && !child.startsWith(`..\\`) && !child.startsWith('../')
}

const server = createServer(async (req, res) => {
  try {
    const pathname = (req.url || '/').split('?')[0]
    if (pathname === '/api/relay') { await handleRelay(req, res); return }
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return }
    let clean
    try { clean = decodeURIComponent(pathname) } catch { res.writeHead(400); res.end(); return }
    if (clean.includes('\0')) { res.writeHead(400); res.end(); return }
    let file = resolve(root, `.${clean === '/' ? '/index.html' : clean}`)
    if (!inside(file)) { res.writeHead(400); res.end(); return }
    const info = await stat(file).catch(() => null)
    if (!info?.isFile()) {
      if (extname(clean)) { res.writeHead(404); res.end(); return }
      file = join(root, 'index.html')
    }
    if (!inside(await realpath(file))) { res.writeHead(400); res.end(); return }
    res.writeHead(200, {
      'Content-Type': MIME[extname(file)] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': file.startsWith(join(root, 'assets')) ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    if (req.method === 'HEAD') { res.end(); return }
    await pipeline(createReadStream(file), res)
  } catch {
    if (res.destroyed) return
    if (res.headersSent) { res.destroy(); return }
    res.writeHead(500); res.end()
  }
})

server.listen(port, host, () => console.log(`绘途 http://${host}:${port}`))
