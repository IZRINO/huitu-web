import { lookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { timingSafeEqual } from 'node:crypto'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import ipaddr from 'ipaddr.js'

const MAX_BYTES = Number(process.env.HUITU_RELAY_MAX_BYTES || 128 * 1024 * 1024)
const TIMEOUT = Number(process.env.HUITU_RELAY_TIMEOUT_MS || 600000)
if (!Number.isSafeInteger(MAX_BYTES) || MAX_BYTES <= 0 || !Number.isSafeInteger(TIMEOUT) || TIMEOUT <= 0 || TIMEOUT > 2147483647) throw new Error('Relay size and timeout limits must be positive integers')
const TOKEN = process.env.HUITU_RELAY_TOKEN || ''
export const publicRelay = process.env.HUITU_RELAY_PUBLIC === 'true' && !TOKEN
const ALLOWED = new Set((process.env.HUITU_RELAY_ALLOWED_HOSTS || '').split(',').map(host => host.trim().toLowerCase()).filter(Boolean))
const FORBIDDEN_HEADERS = new Set(['host', 'connection', 'content-length', 'transfer-encoding', 'upgrade', 'expect', 'trailer', 'te', 'proxy-authorization', 'proxy-connection'])
let active = 0

class RelayError extends Error {
  constructor(status, message, code) { super(message); this.status = status; this.code = code }
}

export function publicAddress(address) {
  try {
    const parsed = ipaddr.process(address)
    return parsed.range() === 'unicast' && (parsed.kind() === 'ipv4' || parsed.match(ipaddr.parse('2000::'), 3))
  }
  catch { return false }
}

export async function targetAddress(url, resolver = lookup) {
  const hostname = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new RelayError(400, 'Invalid relay URL')
  if (hostname === 'metadata.google.internal' || hostname === '169.254.169.254') throw new RelayError(400, 'Relay target is blocked')
  const addresses = ipaddr.isValid(hostname)
    ? [{ address: hostname, family: ipaddr.parse(hostname).kind() === 'ipv4' ? 4 : 6 }]
    : await resolver(hostname, { all: true, verbatim: true })
  if (!addresses.length || (!ALLOWED.has(hostname) && addresses.some(item => !publicAddress(item.address)))) throw new RelayError(400, 'Private and reserved relay targets are blocked')
  return addresses[0]
}

function authorize(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') throw new RelayError(403, 'Cross-origin relay requests are blocked')
  const origin = req.headers.origin
  if (origin) {
    let parsed
    try { parsed = new URL(origin) } catch { throw new RelayError(403, 'Invalid request origin') }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.host !== req.headers.host) throw new RelayError(403, 'Cross-origin relay requests are blocked')
  }
  if (TOKEN) {
    const supplied = Buffer.from(String(req.headers['x-relay-token'] || ''))
    const expected = Buffer.from(TOKEN)
    if (supplied.length !== expected.length || !timingSafeEqual(supplied, expected)) throw new RelayError(403, 'Relay token is required', 'RELAY_TOKEN_REQUIRED')
  } else if (publicRelay) {
    if (!/^Bearer\s+\S+$/i.test(String(req.headers.authorization || ''))) throw new RelayError(401, 'Upstream API key is required')
  } else if (!ipaddr.isValid(req.socket.remoteAddress || '') || ipaddr.process(req.socket.remoteAddress).range() !== 'loopback') {
    throw new RelayError(403, 'Remote relay access requires HUITU_RELAY_TOKEN')
  } else {
    let hostname
    try { hostname = new URL(`http://${req.headers.host}`).hostname.replace(/^\[|\]$/g, '') } catch { throw new RelayError(403, 'Invalid local relay host') }
    if (hostname !== 'localhost' && (!ipaddr.isValid(hostname) || ipaddr.process(hostname).range() !== 'loopback')) throw new RelayError(403, 'Local relay requires a loopback host')
  }
}

function upstreamHeaders(req) {
  const headers = new Headers()
  for (const name of ['authorization', 'content-type']) if (typeof req.headers[name] === 'string') headers.set(name, req.headers[name])
  if (typeof req.headers['content-length'] === 'string') headers.set('Content-Length', req.headers['content-length'])
  if (typeof req.headers['x-relay-organization'] === 'string') headers.set('OpenAI-Organization', req.headers['x-relay-organization'])
  if (req.headers['x-relay-headers']) {
    let extra
    try { extra = JSON.parse(req.headers['x-relay-headers']) } catch { throw new RelayError(400, 'Invalid extra headers JSON') }
    if (!extra || typeof extra !== 'object' || Array.isArray(extra)) throw new RelayError(400, 'Extra headers must be an object')
    for (const [key, value] of Object.entries(extra)) {
      if (typeof value !== 'string' || FORBIDDEN_HEADERS.has(key.toLowerCase()) || key.toLowerCase().startsWith('x-relay-')) throw new RelayError(400, 'Invalid extra header')
      try { headers.set(key, value) } catch { throw new RelayError(400, 'Invalid extra header') }
    }
  }
  return Object.fromEntries(headers)
}

function fail(res, error) {
  if (res.destroyed || res.writableEnded) return
  if (res.headersSent) { res.destroy(); return }
  res.writeHead(error instanceof RelayError ? error.status : 502, { 'Content-Type': 'application/json; charset=utf-8', Connection: 'close' })
  res.end(JSON.stringify({ error: { message: error instanceof RelayError ? error.message : 'Relay upstream failed', ...(error instanceof RelayError && error.code ? { code: error.code } : {}) } }))
}

export async function handleRelay(req, res) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  res.once('close', abort)
  req.once('aborted', abort)
  let timer, acquired = false, outgoing
  try {
    authorize(req)
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }
    if (!['GET', 'POST', 'HEAD'].includes(req.method)) throw new RelayError(405, 'Relay method is not allowed')
    const length = req.headers['content-length']
    if (length && (!/^\d+$/.test(length) || Number(length) > MAX_BYTES)) throw new RelayError(413, 'Relay request exceeds the upload limit')
    if (active >= 3) throw new RelayError(429, 'Relay concurrency limit reached')
    active++; acquired = true
    timer = setTimeout(() => controller.abort(new RelayError(504, 'Relay request timed out')), TIMEOUT)
    let url
    try { url = new URL(String(req.headers['x-relay-url'] || '')) } catch { throw new RelayError(400, 'Invalid relay URL') }
    if (publicRelay && !((req.method === 'GET' && url.pathname.endsWith('/models')) ||
      (req.method === 'POST' && /\/images\/(generations|edits)$/.test(url.pathname)))) {
      throw new RelayError(400, 'Public relay only supports model listing and image requests')
    }
    controller.signal.throwIfAborted()
    let stopLookup
    const cancelled = new Promise((_, reject) => {
      stopLookup = () => reject(controller.signal.reason)
      controller.signal.addEventListener('abort', stopLookup, { once: true })
    })
    let address
    try {
      // DNS lookup cannot be cancelled; stop waiting when the request ends.
      address = await Promise.race([targetAddress(url), cancelled])
    } finally {
      controller.signal.removeEventListener('abort', stopLookup)
    }
    controller.signal.throwIfAborted()
    const headers = upstreamHeaders(req)
    outgoing = (url.protocol === 'https:' ? httpsRequest : httpRequest)(url, {
      method: req.method, headers, signal: controller.signal,
      // Pin the validated address; TLS still validates the original hostname.
      lookup: (_host, options, callback) => options.all ? callback(null, [address]) : callback(null, address.address, address.family),
    })
    const response = new Promise((resolve, reject) => { outgoing.once('response', resolve); outgoing.once('error', reject) })
    let bytes = 0
    const limiter = new Transform({ transform(chunk, _encoding, callback) {
      bytes += chunk.length
      callback(bytes > MAX_BYTES ? new RelayError(413, 'Relay request exceeds the upload limit') : null, chunk)
    } })
    limiter.on('error', error => { fail(res, error); outgoing.destroy(error) })
    req.on('error', error => outgoing.destroy(error))
    req.pipe(limiter).pipe(outgoing)
    const upstream = await response
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      upstream.destroy()
      throw new RelayError(502, 'Relay redirects are blocked; configure the final API address')
    }
    res.statusCode = upstream.statusCode || 502
    if (upstream.headers['content-type']) res.setHeader('Content-Type', upstream.headers['content-type'])
    if (upstream.headers['content-encoding']) res.setHeader('Content-Encoding', upstream.headers['content-encoding'])
    if (upstream.headers['retry-after']) res.setHeader('Retry-After', upstream.headers['retry-after'])
    await pipeline(upstream, res, { signal: controller.signal })
  } catch (error) {
    fail(res, controller.signal.reason instanceof RelayError ? controller.signal.reason : error)
  } finally {
    clearTimeout(timer)
    if (outgoing && !outgoing.destroyed) outgoing.destroy()
    res.off('close', abort)
    req.off('aborted', abort)
    if (acquired) active--
  }
}
