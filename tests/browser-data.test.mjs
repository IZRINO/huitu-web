import test from 'node:test'
import assert from 'node:assert/strict'
import { browserModules } from './browser-modules.mjs'

test('relay authentication errors identify the separate deployment token', async t => {
  const load = await browserModules(t)
  const { describeHttp } = await load('errors')
  for (const error of [{ message: 'Relay token is required' }, { message: 'Relay authentication failed', code: 'RELAY_TOKEN_REQUIRED' }]) {
    const message = describeHttp(403, JSON.stringify({ error }))
    assert.match(message, /代理访问令牌/)
    assert.match(message, /API Key/)
  }
  assert.equal(describeHttp(403, '{"error":{"message":"upstream denied"}}'), 'upstream denied')
})

test('web config export removes credentials from extra headers', async t => {
  const load = await browserModules(t)
  const { exportConfig } = await load('storage')
  const { defaultSettings, defaultParams } = await load('defaults')
  const result = exportConfig({ ...defaultSettings(), apiKey: 'secret-key', extraHeaders: '{"Authorization":"Bearer extra-secret","X-Api-Key":"another-secret"}' }, defaultParams())
  assert.equal(result.includes('secret'), false)
})

test('web config import rejects invalid parameter types and ranges', async t => {
  const load = await browserModules(t)
  const { importConfig } = await load('storage')
  for (const data of [{ params: { n: 1000 } }, { params: { compression: {} } }, { settings: { useProxy: 'false' } }, { params: { quality: 'unknown' } }]) {
    assert.throws(() => importConfig(JSON.stringify(data)))
  }
})

test('inactive size presets do not reset valid params or prevent config import', async t => {
  const load = await browserModules(t)
  const { exportConfig, importConfig, loadParams } = await load('storage')
  const { defaultSettings, defaultParams } = await load('defaults')
  const { resolveSize, validateSize } = await load('size')
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  t.after(() => {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else delete globalThis.localStorage
  })
  for (const sizeMode of ['aspect', 'custom', 'auto']) {
    const params = { ...defaultParams(), sizeMode, sizePreset: '1920x1080', aspect: '16:9', longEdge: 2048, quality: 'high', n: 3 }
    assert.ok(validateSize(resolveSize(params)).ok)
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: () => JSON.stringify(params) } })
    assert.deepEqual(loadParams(), params)
    assert.deepEqual(importConfig(exportConfig(defaultSettings(), params)).params, params)
  }
  assert.throws(() => importConfig(JSON.stringify({ params: { sizeMode: 'preset', sizePreset: '1920x1080' } })))
  assert.throws(() => importConfig(JSON.stringify({ params: { sizeMode: 'auto', sizePreset: {} } })))
})

test('cancellation interrupts browser result URL downloads', async t => {
  const load = await browserModules(t)
  const { generateImage } = await load('api')
  const { defaultSettings } = await load('defaults')
  const controller = new AbortController()
  const reader = globalThis.FileReader
  globalThis.FileReader = class {
    readAsDataURL() { this.result = 'data:image/png;base64,bGF0ZQ=='; queueMicrotask(() => this.onload()) }
  }
  t.after(() => { if (reader) globalThis.FileReader = reader; else delete globalThis.FileReader })
  let downloadStarted
  const ready = new Promise(resolve => { downloadStarted = resolve })
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).endsWith('/images/generations')) return new Response(JSON.stringify({ data: [{ url: 'https://images.example/result.png' }] }), { headers: { 'Content-Type': 'application/json' } })
    downloadStarted()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => resolve(new Response('late')), 150)
      init?.signal?.addEventListener('abort', () => { clearTimeout(timer); reject(init.signal.reason) }, { once: true })
    })
  })
  const promise = generateImage({ ...defaultSettings(), apiKey: 'dummy', useProxy: false }, { model: 'mock', prompt: 'test', size: '1024x1024', quality: 'auto', n: 1, background: 'auto', output_format: 'png', output_compression: 100, moderation: 'auto', stream: false }, { signal: controller.signal })
  const assertion = assert.rejects(promise, { name: 'AbortError' })
  await ready
  controller.abort()
  await assertion
})

test('browser results keep image bytes once, with the actual response format', async t => {
  const load = await browserModules(t)
  const { generateImage } = await load('api')
  const { defaultSettings } = await load('defaults')
  t.mock.method(globalThis, 'fetch', async () => new Response(JSON.stringify({ data: [{ b64_json: 'YWJj' }], output_format: 'webp' }), { headers: { 'Content-Type': 'application/json' } }))
  const result = await generateImage({ ...defaultSettings(), apiKey: 'dummy', useProxy: false }, { model: 'mock', prompt: 'test', size: '1024x1024', quality: 'auto', n: 1, background: 'auto', output_format: 'png', output_compression: 100, moderation: 'auto', stream: false }, { signal: new AbortController().signal })
  assert.ok(result.images[0].blob instanceof Blob)
  assert.equal(result.images[0].blob.type, 'image/webp')
  assert.equal(result.images[0].b64, undefined)
})
