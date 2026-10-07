import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

async function browserApp(t) {
  const reservation = createServer()
  await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve))
  const port = reservation.address().port
  await new Promise(resolve => reservation.close(resolve))
  const child = spawn(process.execPath, ['server.mjs'], { env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', HUITU_RELAY_TOKEN: '' }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
  t.after(async () => { if (child.exitCode === null) { child.kill(); await once(child, 'exit') } })
  await once(child.stdout, 'data')
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : process.platform === 'win32' ? { channel: 'msedge' } : {}) })
  t.after(() => browser.close())
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await context.newPage()
  return { context, page, port }
}

test('browser: legacy history, Blob storage, reference cleanup, masks and responsive layout', { timeout: 90000 }, async t => {
  const { context, page, port } = await browserApp(t)
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.route(`http://127.0.0.1:${port}/audit-seed`, route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto(`http://127.0.0.1:${port}/audit-seed`)
  const png = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 32; c.height = 32
    const ctx = c.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, 32, 32)
    const dataUrl = c.toDataURL('image/png')
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('huitu-prints', 1)
      req.onupgradeneeded = () => { const store = req.result.createObjectStore('prints', { keyPath: 'id' }); store.createIndex('createdAt', 'createdAt') }
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('prints', 'readwrite')
    tx.objectStore('prints').put({ id: 'legacy', createdAt: 1, prompt: 'legacy', model: 'mock', mode: 'generate', size: '32x32', quality: 'auto', background: 'opaque', format: 'png', n: 1, dataUrl })
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
    db.close()
    localStorage.setItem('huitu.settings.v1', JSON.stringify({ baseUrl: 'https://audit.invalid/v1', apiKey: 'dummy', model: 'mock', useProxy: false, extraHeaders: '', organization: '' }))
    return dataUrl.split(',')[1]
  })
  await page.addInitScript(() => {
    const create = URL.createObjectURL.bind(URL), revoke = URL.revokeObjectURL.bind(URL)
    window.auditUrls = new Set()
    URL.createObjectURL = (...args) => { const url = create(...args); window.auditUrls.add(url); return url }
    URL.revokeObjectURL = url => { window.auditUrls.delete(url); revoke(url) }
    const read = CanvasRenderingContext2D.prototype.getImageData
    window.auditReadbacks = 0
    CanvasRenderingContext2D.prototype.getImageData = function (...args) { window.auditReadbacks++; return read.apply(this, args) }
  })
  const requests = []
  await page.route('https://audit.invalid/**', async route => {
    requests.push({ url: route.request().url(), body: route.request().postDataBuffer(), contentType: route.request().headers()['content-type'] })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: [{ b64_json: png }] }) })
  })
  await page.goto(`http://127.0.0.1:${port}`)
  await page.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('1'))
  await page.locator('.strip > button').first().click()
  await page.locator('img.frame').waitFor()
  await page.locator('.prompt-dock textarea').fill('audit')
  await page.getByRole('button', { name: '生成图像', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('2'))
  const stored = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('huitu-prints'); r.onsuccess = () => resolve(r.result) })
    const rows = await new Promise(resolve => { const r = db.transaction('prints').objectStore('prints').getAll(); r.onsuccess = () => resolve(r.result) })
    const hasImages = db.objectStoreNames.contains('images')
    let blobCount = 0
    if (hasImages) blobCount = await new Promise(resolve => { const r = db.transaction('images').objectStore('images').getAll(); r.onsuccess = () => resolve(r.result.filter(item => item.blob instanceof Blob).length) })
    db.close()
    return { hasImages, blobCount, containsFullData: rows.some(row => row.dataUrl), thumbnails: rows.every(row => row.thumbnail?.startsWith('data:image/')) }
  })
  assert.deepEqual(stored, { hasImages: true, blobCount: 2, containsFullData: false, thumbnails: true })
  await page.getByRole('button', { name: '改图', exact: true }).click()
  await page.getByRole('button', { name: '当前片作底' }).click()
  await page.evaluate(() => {
    window.auditOriginalImage = window.Image
    const descriptor = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src')
    window.Image = function (...args) {
      const img = new window.auditOriginalImage(...args)
      Object.defineProperty(img, 'src', { set(value) { setTimeout(() => descriptor.set.call(img, value), 350) }, get() { return descriptor.get.call(img) } })
      return img
    }
  })
  await page.getByRole('button', { name: '涂蒙版', exact: true }).click()
  await page.getByRole('button', { name: '清空', exact: true }).click()
  const canvas = page.locator('.mask-stage canvas').first()
  await page.waitForFunction(() => document.querySelector('.mask-stage canvas')?.width === 32, undefined, { timeout: 1500 })
  await page.evaluate(() => { window.Image = window.auditOriginalImage })
  await canvas.scrollIntoViewIfNeeded()
  const bounds = await canvas.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
  await page.mouse.down(); await page.mouse.up()
  await page.waitForTimeout(100)
  assert.equal(await page.evaluate(() => window.auditReadbacks), 0)
  await page.getByRole('button', { name: '应用编辑', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('3'))
  assert.ok(requests.at(-1).body.toString().includes('name="mask"'), requests.at(-1).body.toString())
  const firstForm = await new Response(requests.at(-1).body, { headers: { 'Content-Type': requests.at(-1).contentType } }).formData()
  const firstMask = await firstForm.get('mask').arrayBuffer()
  await page.getByRole('button', { name: '应用编辑', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('4'))
  assert.ok(requests.at(-1).body.toString().includes('name="mask"'), 'Repeated edits on the same reference must retain the painted mask')
  const repeatedForm = await new Response(requests.at(-1).body, { headers: { 'Content-Type': requests.at(-1).contentType } }).formData()
  assert.deepEqual(await repeatedForm.get('mask').arrayBuffer(), firstMask)
  await page.getByRole('button', { name: '收起蒙版', exact: true }).click()
  await page.getByRole('button', { name: '移除', exact: true }).click()
  const upload = page.locator('input[type=file][accept="image/png,image/jpeg,image/webp"]')
  await upload.setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })
  await page.getByRole('button', { name: '应用编辑', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('5'))
  assert.equal(requests.at(-1).body.toString().includes('name="mask"'), false)
  await upload.setInputFiles(Array.from({ length: 20 }, (_, index) => ({ name: `ref${index}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') })))
  assert.equal(await page.locator('.ref').count(), 16)
  assert.equal(await page.evaluate(() => window.auditUrls.size), 17)
  assert.ok(await page.locator('.sheet').evaluate(element => {
    const bounds = element.getBoundingClientRect()
    return Math.abs(bounds.width / bounds.height - 1) < 0.01
  }), 'The square canvas must keep its aspect ratio within the available preview height')
  await mkdir('.playwright-mcp', { recursive: true })
  await page.screenshot({ path: '.playwright-mcp/audit-fixed-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
  await page.screenshot({ path: '.playwright-mcp/audit-fixed-mobile.png', fullPage: true })
  await page.locator('.strip').first().locator('button').first().click()
  await page.waitForFunction(() => document.querySelector('.strip')?.classList.contains('is-on'))
  await page.evaluate(() => {
    const descriptor = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete')
    window.auditTxDescriptor = descriptor
    Object.defineProperty(IDBTransaction.prototype, 'oncomplete', { ...descriptor, set(callback) {
      descriptor.set.call(this, this.mode === 'readwrite' ? function (event) { setTimeout(() => callback.call(this, event), 1000) } : callback)
    } })
  })
  await page.evaluate(() => {
    const strips = document.querySelectorAll('.strip')
    strips[0].querySelector('button.kill').click()
    strips[1].querySelector('button').click()
  })
  await page.waitForFunction(() => document.querySelectorAll('.strip')[1]?.classList.contains('is-on'))
  const selected = await page.locator('img.frame').getAttribute('src')
  await page.waitForTimeout(1500)
  assert.equal(await page.evaluate(() => document.querySelector('img.frame')?.getAttribute('src')), selected)
  await page.evaluate(() => Object.defineProperty(IDBTransaction.prototype, 'oncomplete', window.auditTxDescriptor))
  await page.evaluate(async data => {
    const db = await new Promise(resolve => { const req = indexedDB.open('huitu-prints'); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('prints', 'readwrite')
    tx.objectStore('prints').put({ id: 'migration-race', createdAt: 2, prompt: 'race', model: 'mock', mode: 'generate', size: '32x32', format: 'png', quality: 'auto', background: 'opaque', n: 1, dataUrl: `data:image/png;base64,${data}` })
    await new Promise(resolve => { tx.oncomplete = resolve }); db.close()
  }, png)
  const other = await page.context().newPage()
  await other.addInitScript(() => {
    const decode = createImageBitmap
    window.createImageBitmap = async (...args) => {
      window.auditMigrationStarted = true
      await new Promise(resolve => { window.auditResumeMigration = resolve })
      return decode(...args)
    }
  })
  await other.goto(`http://127.0.0.1:${port}`)
  await other.waitForFunction(() => window.auditMigrationStarted)
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('huitu-prints'); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('prints', 'readwrite'); tx.objectStore('prints').delete('migration-race')
    await new Promise(resolve => { tx.oncomplete = resolve }); db.close()
  })
  await other.evaluate(() => window.auditResumeMigration())
  await other.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('4'))
  assert.equal(await page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('huitu-prints'); req.onsuccess = () => resolve(req.result) })
    const row = await new Promise(resolve => { const req = db.transaction('prints').objectStore('prints').get('migration-race'); req.onsuccess = () => resolve(req.result) })
    db.close(); return !!row
  }), false)
  await other.close()
  await page.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('huitu-prints'); req.onsuccess = () => resolve(req.result) })
    const tx = db.transaction('prints', 'readwrite')
    tx.objectStore('prints').put({ id: 'decode-failure', createdAt: 3, prompt: 'decode', model: 'mock', mode: 'generate', size: '32x32', format: 'png', quality: 'auto', background: 'opaque', n: 1, dataUrl: 'data:image/png;base64,' + btoa('invalid'.repeat(10000)) })
    await new Promise(resolve => { tx.oncomplete = resolve }); db.close()
  })
  const recovery = await context.newPage()
  await recovery.goto(`http://127.0.0.1:${port}`)
  await recovery.waitForFunction(() => document.querySelector('.rail-head')?.textContent.includes('5'))
  assert.ok(await recovery.evaluate(async () => {
    const db = await new Promise(resolve => { const req = indexedDB.open('huitu-prints'); req.onsuccess = () => resolve(req.result) })
    const row = await new Promise(resolve => { const req = db.transaction('prints').objectStore('prints').get('decode-failure'); req.onsuccess = () => resolve(req.result) })
    db.close(); return row.thumbnail.length < 500 && !row.dataUrl
  }))
  await recovery.close()
  assert.deepEqual(errors, [])
})

test('browser: valid params survive a reload after leaving the FHD preset', { timeout: 30000 }, async t => {
  const { page, port } = await browserApp(t)
  await page.goto(`http://127.0.0.1:${port}`)
  await page.getByRole('button', { name: 'FHD', exact: true }).click()
  await page.getByRole('button', { name: '比例', exact: true }).click()
  await page.getByRole('button', { name: '16:9', exact: true }).click()
  await page.getByRole('button', { name: '长边 2048', exact: true }).click()
  await page.getByLabel('图像质量', { exact: true }).selectOption('high')
  const before = await page.evaluate(() => JSON.parse(localStorage.getItem('huitu.params.v1')))
  await page.reload()
  const after = await page.evaluate(() => JSON.parse(localStorage.getItem('huitu.params.v1')))
  assert.deepEqual(after, before)
  assert.equal(await page.getByRole('button', { name: '比例', exact: true }).getAttribute('class'), 'is-on')
})

test('browser: malformed legacy history does not block reading, deletion or clearing', { timeout: 30000 }, async t => {
  const { page, port } = await browserApp(t)
  await page.route(`http://127.0.0.1:${port}/audit-seed`, route => route.fulfill({ contentType: 'text/html', body: '<html><body></body></html>' }))
  await page.goto(`http://127.0.0.1:${port}/audit-seed`)
  await page.evaluate(async () => {
    const canvas = document.createElement('canvas'); canvas.width = 32; canvas.height = 32
    const db = await new Promise((resolve, reject) => {
      const req = indexedDB.open('huitu-prints', 1)
      req.onupgradeneeded = () => { const store = req.result.createObjectStore('prints', { keyPath: 'id' }); store.createIndex('createdAt', 'createdAt') }
      req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error)
    })
    const tx = db.transaction('prints', 'readwrite')
    for (const [index, id] of ['good', 'bad-delete', 'bad-clear'].entries()) {
      tx.objectStore('prints').put({ id, createdAt: index + 1, prompt: id, model: 'mock', mode: 'generate', size: '32x32', quality: 'auto', background: 'opaque', format: 'png', n: 1, dataUrl: id === 'good' ? canvas.toDataURL('image/png') : 'data:image/png;base64,%' })
    }
    await new Promise((resolve, reject) => { tx.oncomplete = resolve; tx.onerror = () => reject(tx.error) })
    db.close()
  })
  await page.goto(`http://127.0.0.1:${port}`)
  await page.waitForFunction(() => document.querySelectorAll('.strip').length === 3, undefined, { timeout: 3000 })
  await page.locator('.strip > button[title="good"]').click()
  await page.locator('img.frame').waitFor()
  const retained = await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('huitu-prints'); r.onsuccess = () => resolve(r.result) })
    const raw = await new Promise(resolve => { const r = db.transaction('images').objectStore('images').get('bad-delete'); r.onsuccess = () => resolve(r.result) })
    const row = await new Promise(resolve => { const r = db.transaction('prints').objectStore('prints').get('bad-delete'); r.onsuccess = () => resolve(r.result) })
    db.close()
    return { source: raw?.dataUrl, thumbnail: row.thumbnail?.startsWith('data:image/'), hasFullData: !!row.dataUrl }
  })
  assert.deepEqual(retained, { source: 'data:image/png;base64,%', thumbnail: true, hasFullData: false })
  const damagedStrip = page.locator('.strip').filter({ has: page.locator('button[title="bad-delete"]') })
  await damagedStrip.hover()
  await damagedStrip.getByRole('button', { name: '删除', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.strip').length === 2)
  await page.getByRole('button', { name: '中转站', exact: true }).click()
  await page.getByRole('button', { name: '清空底片', exact: true }).click()
  await page.waitForFunction(() => document.querySelectorAll('.strip').length === 0)
  assert.deepEqual(await page.evaluate(async () => {
    const db = await new Promise(resolve => { const r = indexedDB.open('huitu-prints'); r.onsuccess = () => resolve(r.result) })
    const counts = await Promise.all(['prints', 'images'].map(name => new Promise(resolve => { const r = db.transaction(name).objectStore(name).count(); r.onsuccess = () => resolve(r.result) })))
    db.close(); return counts
  }), [0, 0])
})
