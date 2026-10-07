import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer, request } from 'node:http'
import { once } from 'node:events'
import { setTimeout as delay } from 'node:timers/promises'
import { publicAddress, targetAddress } from '../server/relay.mjs'

async function serve(t, env = {}, nodeArgs = []) {
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(process.execPath, [...nodeArgs, 'server.mjs'], {
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), HUITU_RELAY_TOKEN: 'audit-token', HUITU_RELAY_ALLOWED_HOSTS: '', ...env },
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
  })
  let stderr = ''
  let stdout = ''
  child.stdout.on('data', chunk => { stdout += chunk })
  child.stderr.on('data', chunk => { stderr += chunk })
  t.after(async () => {
    if (child.exitCode === null) { child.kill(); await once(child, 'exit') }
  })
  await Promise.race([once(child.stdout, 'data'), once(child, 'exit').then(() => { throw new Error(stderr) }), delay(5000).then(() => { throw new Error('Server startup timeout') })])
  return { port, child, stdout: () => stdout, get: (path, headers = {}, method = 'GET', body) => new Promise((resolve, reject) => {
    const req = request({ hostname: '127.0.0.1', port, path, method, headers }, res => {
      const chunks = []
      res.on('data', chunk => chunks.push(chunk))
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString() }))
      res.on('error', reject)
    })
    req.on('error', reject)
    req.setTimeout(4000, () => req.destroy(new Error('Request timeout')))
    req.end(body)
  }) }
}

async function upstream(t, handler) {
  const server = createServer(handler)
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) })
  return `http://127.0.0.1:${server.address().port}/v1/models`
}

test('malformed paths return 400 and leave the server running', async t => {
  const server = await serve(t)
  const response = await server.get('/%').catch(error => ({ status: error.code }))
  assert.equal(response.status, 400)
  assert.equal((await server.get('/')).status, 200)
})

test('encoded paths cannot escape into a sibling static directory', async t => {
  const server = await serve(t)
  assert.equal((await server.get('/%2e%2e%2fdist-cli%2fcli%2fconfig.js')).status, 400)
})

test('configured relay token is required separately from the upstream key', async t => {
  const target = await upstream(t, (_req, res) => res.end('private'))
  const server = await serve(t)
  assert.equal((await server.get('/api/relay', { 'x-relay-url': target, Authorization: 'Bearer upstream-key' })).status, 403)
})

test('relay rejects loopback targets unless explicitly allowed', async t => {
  let hits = 0
  const target = await upstream(t, (_req, res) => { hits++; res.end('private') })
  const server = await serve(t)
  assert.equal((await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token' })).status, 400)
  assert.equal(hits, 0)
})

test('relay rejects oversized uploads before forwarding any bytes', async t => {
  let hits = 0
  const target = await upstream(t, (_req, res) => { hits++; res.end('private') })
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1' })
  const result = await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token', 'Content-Length': String(1024 ** 3) }, 'POST')
  assert.equal(result.status, 413)
  assert.equal(hits, 0)
})

test('cross-origin browser requests cannot use the local relay', async t => {
  const target = await upstream(t, (_req, res) => res.end('private'))
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1' })
  assert.equal((await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token', Origin: 'https://untrusted.example' })).status, 403)
})

test('client disconnect aborts the upstream before response headers arrive', async t => {
  let closed = false, started
  const ready = new Promise(resolve => { started = resolve })
  const target = await upstream(t, (_req, res) => { res.on('close', () => { closed = true }); started() })
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1' })
  const req = request({ hostname: '127.0.0.1', port: server.port, path: '/api/relay', headers: { 'x-relay-url': target, 'x-relay-token': 'audit-token' } })
  req.on('error', () => undefined)
  req.end()
  await ready
  req.destroy()
  for (let i = 0; i < 20 && !closed; i++) await delay(25)
  assert.equal(closed, true)
})

test('allowed upstream responses preserve status, content type and body', async t => {
  const target = await upstream(t, (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer upstream-key')
    assert.equal(req.headers['x-relay-token'], undefined)
    res.writeHead(429, { 'Content-Type': 'application/json' })
    res.end('{"error":{"message":"rate limit"}}')
  })
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1' })
  const result = await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token', Authorization: 'Bearer upstream-key' })
  assert.equal(result.status, 429)
  assert.match(result.body, /rate limit/)
})

test('all resolved addresses must be public, including IPv4-mapped IPv6', async () => {
  for (const address of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', '::', 'fc00::1', 'fe80::1', '::ffff:127.0.0.1', '4000::1']) assert.equal(publicAddress(address), false, address)
  assert.equal(publicAddress('8.8.8.8'), true)
  assert.equal(publicAddress('2606:4700:4700::1111'), true)
  await assert.rejects(targetAddress(new URL('https://mixed.example/v1/models'), async () => [{ address: '8.8.8.8', family: 4 }, { address: '127.0.0.1', family: 4 }]), /blocked/)
  assert.deepEqual(await targetAddress(new URL('https://public.example/v1/models'), async () => [{ address: '8.8.8.8', family: 4 }]), { address: '8.8.8.8', family: 4 })
})

test('relay never follows a redirect to another target', async t => {
  let privateHits = 0
  const privateTarget = await upstream(t, (_req, res) => { privateHits++; res.end('private') })
  const target = await upstream(t, (_req, res) => { res.writeHead(302, { Location: privateTarget }); res.end() })
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1' })
  assert.equal((await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token' })).status, 502)
  assert.equal(privateHits, 0)
})

test('chunked uploads cannot bypass the byte limit', async t => {
  const target = await upstream(t, (req, res) => { req.resume(); req.on('end', () => res.end('uploaded')) })
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1', HUITU_RELAY_MAX_BYTES: '1024' })
  const result = await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token', 'Transfer-Encoding': 'chunked' }, 'POST', Buffer.alloc(2048))
  assert.equal(result.status, 413)
  assert.equal((await server.get('/')).status, 200)
})

test('relay timeout closes a stalled upstream and releases the slot', async t => {
  const target = await upstream(t, () => undefined)
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1', HUITU_RELAY_TIMEOUT_MS: '100' })
  assert.equal((await server.get('/api/relay', { 'x-relay-url': target, 'x-relay-token': 'audit-token' })).status, 504)
  assert.equal((await server.get('/')).status, 200)
})

async function waitForLookups(server, count) {
  for (let i = 0; i < 40; i++) {
    if ((server.stdout().match(/DNS lookup started/g) || []).length >= count) return
    await delay(25)
  }
  assert.fail('Pending DNS lookups did not start')
}

test('DNS timeout releases relay slots before the lookup completes', async t => {
  const target = await upstream(t, (_req, res) => res.end('available'))
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1', HUITU_RELAY_TIMEOUT_MS: '100' }, ['--import', './tests/fixtures/delayed-dns.mjs'])
  const headers = { 'x-relay-url': 'http://pending.invalid/v1/models', 'x-relay-token': 'audit-token' }
  let completed = 0
  const pending = Promise.all(Array.from({ length: 3 }, () => server.get('/api/relay', headers).then(result => { completed++; return result.status })))
  await waitForLookups(server, 3)
  await delay(250)
  assert.equal(completed, 3, 'DNS wait must finish at the relay deadline')
  assert.deepEqual(await pending, [504, 504, 504])
  assert.equal((await server.get('/api/relay', { ...headers, 'x-relay-url': target })).status, 200)
})

test('client disconnect releases relay slots while DNS is pending', async t => {
  const target = await upstream(t, (_req, res) => res.end('available'))
  const server = await serve(t, { HUITU_RELAY_ALLOWED_HOSTS: '127.0.0.1', HUITU_RELAY_TIMEOUT_MS: '5000' }, ['--import', './tests/fixtures/delayed-dns.mjs'])
  const headers = { 'x-relay-url': 'http://pending.invalid/v1/models', 'x-relay-token': 'audit-token' }
  const pending = Array.from({ length: 3 }, () => {
    const req = request({ hostname: '127.0.0.1', port: server.port, path: '/api/relay', headers })
    req.on('error', () => undefined)
    req.end()
    return req
  })
  t.after(() => pending.forEach(req => req.destroy()))
  await waitForLookups(server, 3)
  pending.forEach(req => req.destroy())
  await delay(100)
  assert.equal((await server.get('/api/relay', { ...headers, 'x-relay-url': target })).status, 200)
})
