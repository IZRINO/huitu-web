import { createReadStream, existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { extname, join, normalize } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(fileURLToPath(new URL('.', import.meta.url)), 'dist')
const port = Number(process.env.PORT || 4173)
const BLOCKED = new Set(['169.254.169.254', 'metadata.google.internal'])

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2',
}

async function handleRelay(req, res) {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
    })
    res.end()
    return
  }
  const target = req.headers['x-relay-url']
  if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: '缺少合法的中转站地址' } }))
    return
  }
  let url
  try {
    url = new URL(target)
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: '中转站地址无法解析' } }))
    return
  }
  if (BLOCKED.has(url.hostname.toLowerCase())) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: '拒绝转发到该主机' } }))
    return
  }
  const chunks = []
  for await (const c of req) chunks.push(c)
  const headers = new Headers()
  if (req.headers.authorization) headers.set('Authorization', req.headers.authorization)
  if (req.headers['content-type']) headers.set('Content-Type', req.headers['content-type'])
  if (req.headers['x-relay-organization']) headers.set('OpenAI-Organization', req.headers['x-relay-organization'])
  if (req.headers['x-relay-headers']) {
    try {
      const extra = JSON.parse(req.headers['x-relay-headers'])
      for (const [k, v] of Object.entries(extra)) if (typeof v === 'string') headers.set(k, v)
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
      res.end(JSON.stringify({ error: { message: '额外请求头不是合法 JSON' } }))
      return
    }
  }
  const method = req.method || 'GET'
  const init = { method, headers }
  if (method !== 'GET' && method !== 'HEAD' && chunks.length) init.body = Buffer.concat(chunks)
  try {
    const upstream = await fetch(url, init)
    const uct = upstream.headers.get('content-type')
    res.writeHead(upstream.status, uct ? { 'Content-Type': uct } : undefined)
    if (!upstream.body) {
      res.end()
      return
    }
    const reader = upstream.body.getReader()
    res.on('close', () => reader.cancel().catch(() => undefined))
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(JSON.stringify({ error: { message: err instanceof Error ? err.message : '中转失败' } }))
  }
}

function safePath(urlPath) {
  const clean = decodeURIComponent(urlPath.split('?')[0])
  const resolved = normalize(join(root, clean))
  if (!resolved.startsWith(root)) return null
  return resolved
}

const server = createServer(async (req, res) => {
  const url = req.url || '/'
  if (url.startsWith('/api/relay')) {
    await handleRelay(req, res)
    return
  }
  let file = safePath(url === '/' ? '/index.html' : url)
  if (!file) {
    res.writeHead(400)
    res.end()
    return
  }
  if (!existsSync(file) || !extname(file)) file = join(root, 'index.html')
  const type = MIME[extname(file)] || 'application/octet-stream'
  res.writeHead(200, { 'Content-Type': type })
  createReadStream(file).pipe(res)
})

server.listen(port, () => {
  console.log(`绘途 http://127.0.0.1:${port}`)
})
