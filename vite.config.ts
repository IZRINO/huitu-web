import react from '@vitejs/plugin-react'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig, type Plugin } from 'vite'

const BLOCKED_HOSTS = new Set(['169.254.169.254', 'metadata.google.internal'])

function hostBlocked(hostname: string): boolean {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (BLOCKED_HOSTS.has(h)) return true
  if (h === '0.0.0.0' || h === '::' || h === '[::]') return true
  return false
}

async function handleRelay(req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (req.method === 'OPTIONS') {
    res.statusCode = 204
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS')
    res.end()
    return
  }
  const target = req.headers['x-relay-url']
  if (typeof target !== 'string' || !/^https?:\/\//i.test(target)) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: { message: '缺少合法的中转站地址' } }))
    return
  }
  let url: URL
  try {
    url = new URL(target)
  } catch {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: { message: '中转站地址无法解析' } }))
    return
  }
  if (hostBlocked(url.hostname)) {
    res.statusCode = 400
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ error: { message: '拒绝转发到该主机' } }))
    return
  }
  const chunks: Buffer[] = []
  await new Promise<void>((resolve, reject) => {
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => resolve())
    req.on('error', reject)
  })
  const headers = new Headers()
  const auth = req.headers.authorization
  if (typeof auth === 'string') headers.set('Authorization', auth)
  const ct = req.headers['content-type']
  if (typeof ct === 'string') headers.set('Content-Type', ct)
  const org = req.headers['x-relay-organization']
  if (typeof org === 'string' && org) headers.set('OpenAI-Organization', org)
  const extra = req.headers['x-relay-headers']
  if (typeof extra === 'string' && extra) {
    try {
      const obj = JSON.parse(extra) as Record<string, unknown>
      for (const [k, v] of Object.entries(obj)) {
        if (typeof v === 'string') headers.set(k, v)
      }
    } catch {
      res.statusCode = 400
      res.setHeader('Content-Type', 'application/json; charset=utf-8')
      res.end(JSON.stringify({ error: { message: '额外请求头不是合法 JSON' } }))
      return
    }
  }
  const method = req.method ?? 'GET'
  const init: RequestInit = { method, headers }
  if (method !== 'GET' && method !== 'HEAD' && chunks.length) {
    init.body = Buffer.concat(chunks)
  }
  try {
    const upstream = await fetch(url, init)
    res.statusCode = upstream.status
    const uct = upstream.headers.get('content-type')
    if (uct) res.setHeader('Content-Type', uct)
    if (!upstream.body) {
      res.end()
      return
    }
    const reader = upstream.body.getReader()
    const abort = () => {
      reader.cancel().catch(() => undefined)
    }
    res.on('close', abort)
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) res.write(Buffer.from(value))
    }
    res.end()
  } catch (err) {
    res.statusCode = 502
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    const message = err instanceof Error ? err.message : '中转失败'
    res.end(JSON.stringify({ error: { message } }))
  }
}

function relayPlugin(): Plugin {
  return {
    name: 'huitu-relay',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/relay')) {
          next()
          return
        }
        void handleRelay(req, res)
      })
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/relay')) {
          next()
          return
        }
        void handleRelay(req, res)
      })
    },
  }
}

export default defineConfig({
  plugins: [react(), relayPlugin()],
  server: { host: '127.0.0.1', port: 5173, strictPort: true },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true },
})
