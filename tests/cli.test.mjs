import test, { after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, writeFile, readdir, rm } from 'node:fs/promises'
import { cpSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=', 'base64')
const skillCopy = process.env.HUITU_TEST_SKILL === '1' ? mkdtempSync(join(tmpdir(), 'huitu-portable-')) : undefined
if (skillCopy) {
  cpSync(resolve('skills/huitu-image'), join(skillCopy, 'skill'), { recursive: true })
  after(() => rm(skillCopy, { recursive: true, force: true }))
}
const bin = skillCopy ? join(skillCopy, 'skill/scripts/huitu.mjs') : resolve('bin/huitu.mjs')
const apiPath = skillCopy ? join(skillCopy, 'skill/scripts/runtime/src/lib/api.js') : resolve('dist-cli/src/lib/api.js')
const { parseResponse } = await import(pathToFileURL(apiPath).href)
function cli(home, args, stdin = '', env = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [bin, '--home', home, '--json', ...args], { cwd: skillCopy, windowsHide: true, env: { ...process.env, NODE_PATH: '', ...env }, stdio: ['pipe','pipe','pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(new Error(`CLI timeout: ${args.join(' ')}\n${stderr}`)) }, 45000)
    child.on('error', reject)
    child.stdout.on('data', c => stdout += c)
    child.stderr.on('data', c => stderr += c)
    child.on('exit', code => {
      clearTimeout(timer)
      try { resolvePromise({ code, stdout, stderr, result: stdout.trim() ? JSON.parse(stdout) : undefined }) }
      catch { reject(new Error(`Invalid CLI JSON: ${stdout}\n${stderr}`)) }
    })
    child.stdin.end(stdin)
  })
}
async function ok(home, args, stdin, env) {
  const response = await cli(home, args, stdin, env)
  assert.equal(response.code, 0, JSON.stringify(response))
  return response.result.data
}
async function until(fn, timeout = 12000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) { if (await fn()) return; await delay(80) }
  throw new Error('Condition timeout')
}

test('SSE: split CRLF, multiline JSON, partial exclusion, multiple final images', async () => {
  const events = [
    'event: image.partial\r\ndata: {"b64_json":"partial"}\r\n\r\n',
    'data: {"type":"image.completed",\r\ndata: "b64_json":"first", "output_index":0}\r\n\r\n',
    'data: {"type":"image.completed","b64_json":"second","output_index":1}\r\n\r\n',
    'data: {"usage":{"total_tokens":7}}\r\n\r\ndata: [DONE]\r\n\r\n',
  ].join('')
  const bytes = new TextEncoder().encode(events)
  const body = new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 3) controller.enqueue(bytes.slice(i, i + 3)); controller.close() } })
  const partials = []
  const result = await parseResponse(new Response(body, { headers: { 'Content-Type':'text/event-stream' } }), 'png', true, p => partials.push(p))
  assert.deepEqual(result.data, [{ b64_json:'first' }, { b64_json:'second' }]); assert.equal(partials.length, 1); assert.equal(result.usage.total_tokens, 7)
  await assert.rejects(parseResponse(new Response('data: {"type":"image.partial","b64_json":"x"}\n\n', { headers: { 'Content-Type':'text/event-stream' } }), 'png', true), /没有成片/)
})

test('CLI end-to-end: configuration, shared queue, editing, downloads and recovery', { timeout: 180000 }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'huitu-test-'))
  const home = join(root, '配置 空间'), out = join(root, '图片 空间')
  const requests = [], sockets = new Set()
  let running = 0, peak = 0, urlHits = 0, failDownloads = true, onceHits = 0
  const server = createServer(async (req, res) => {
    if (req.url === '/v1/models') { res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({ data:[{ id:'mock-image' }] })); return }
    if (req.url === '/download') {
      urlHits++
      if (failDownloads) { res.writeHead(503); res.end('unavailable'); return }
      res.setHeader('Content-Type', 'image/png'); res.end(png); return
    }
    if (req.url === '/once') {
      onceHits++
      if (onceHits > 1) { res.writeHead(410); res.end(); return }
      res.setHeader('Content-Type','image/png'); res.end(png); return
    }
    if (req.url === '/slowdownload') { await delay(2000); if (!res.destroyed) { res.setHeader('Content-Type','image/png'); res.end(png) }; return }
    const chunks = []; for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks)
    let input
    if (req.headers['content-type']?.includes('multipart/form-data')) {
      const form = await new Response(body, { headers:{ 'Content-Type':req.headers['content-type'] } }).formData()
      input = Object.fromEntries(form); input.imageCount = form.getAll('image').length
    } else input = JSON.parse(body.toString())
    requests.push({ path:req.url, headers:req.headers, input })
    running++; peak = Math.max(peak, running)
    let decremented = false
    const decrement = () => { if (!decremented) { running--; decremented = true } }
    res.on('close', decrement)
    await delay(String(input.prompt).startsWith('hold') ? 3000 : String(input.prompt).startsWith('parallel') ? 650 : 20)
    if (res.destroyed) return
    if (input.prompt === 'error') {
      res.writeHead(500, { 'Content-Type':'application/json' }); res.end(JSON.stringify({ error: { message: 'Rejected secret-key and secret-header' } })); decrement(); return
    }
    if (input.prompt === 'stream') {
      res.setHeader('Content-Type','text/event-stream')
      res.write(`event: image.partial\r\ndata: ${JSON.stringify({ b64_json:'preview' })}\r\n\r\n`)
      for (let i = 0; i < Number(input.n); i++) res.write(`data: ${JSON.stringify({ type:'image.completed', output_index:i, b64_json:png.toString('base64') })}\r\n\r\n`)
      res.end('data: [DONE]\r\n\r\n')
    } else {
      res.setHeader('Content-Type','application/json')
      const image = input.prompt === 'url' ? { url:`http://127.0.0.1:${server.address().port}/download` } : input.prompt === 'dataurl' ? { url:`data:image/png;base64,${png.toString('base64')}` } : { b64_json: png.toString('base64') }
      const data = input.prompt === 'resume-download' || input.prompt === 'partial-retry' ? [{ url:`http://127.0.0.1:${server.address().port}/once` }, { url:`http://127.0.0.1:${server.address().port}/${input.prompt === 'partial-retry' ? 'download' : 'slowdownload'}` }] : input.prompt === 'cancel-download' ? [{ url:`http://127.0.0.1:${server.address().port}/slowdownload` }] : Array.from({ length:Number(input.n) }, () => image)
      res.end(JSON.stringify({ data, usage: { total_tokens:9 } }))
    }
    decrement()
  })
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)) })
  await new Promise(resolvePromise => server.listen(0, '127.0.0.1', resolvePromise))
  t.after(async () => {
    try { await cli(home, ['worker','stop']); await until(async () => !(await ok(home, ['worker','status'])).pid) } catch { /* Preserve test assertion while cleaning up. */ }
    for (const socket of sockets) socket.destroy()
    await new Promise(resolvePromise => server.close(resolvePromise))
    await rm(root, { recursive:true, force:true })
  })
  const base = `http://127.0.0.1:${server.address().port}/v1`
  await t.test('single worker under concurrent startup and named profiles', async () => {
    const starts = await Promise.all(Array.from({ length:8 }, () => ok(home, ['worker','start'])))
    assert.equal(new Set(starts.map(s => s.pid)).size, 1)
    await ok(home, ['config','set','--output-dir',out])
    await ok(home, ['profile','set','mock','--base-url',base,'--api-key','secret-key','--model','mock-image','--organization','org-test','--extra-headers','{"X-Test":"secret-header"}'])
    await ok(home, ['profile','use','mock'])
    const config = await ok(home, ['config','show']); assert.equal(config.concurrency, 3); assert.equal(config.profiles.mock.settings.apiKey, '')
    assert.equal(JSON.stringify(config).includes('secret-header'), false)
    assert.deepEqual((await ok(home, ['models','list'])).models, ['mock-image'])
  })
  await t.test('ten separate CLI submissions share exactly three concurrent slots', async () => {
    peak = 0
    const jobs = await Promise.all(Array.from({ length:10 }, (_, i) => ok(home, ['generate','--prompt',`parallel ${i}`])))
    assert.equal(new Set(jobs.map(j => j.id)).size, 10)
    const complete = await Promise.all(jobs.map(job => ok(home, ['jobs','wait',job.id])))
    assert.equal(peak, 3)
    for (const job of complete) { assert.equal(job.status,'succeeded'); assert.deepEqual(await readFile(job.files[0]), png); assert.ok(job.files[0].startsWith(out)) }
    const listed = await ok(home, ['jobs','list'])
    const starts = listed.filter(j => j.prompt.startsWith('parallel')).map(j => j.startedAt)
    assert.deepEqual(starts, [...starts].sort())
  })
  await t.test('all generation options, image variants and JSON input', async () => {
    const job = await ok(home, ['generate','--prompt','stream','--n','2','--stream','--partial-images','3','--quality','max','--background','transparent','--format','webp','--compression','70','--moderation','low','--aspect','16:9','--long-edge','2048','--wait'])
    assert.equal(job.files.length, 2)
    assert.ok(job.files.every(path => path.endsWith('.png')))
    const request = requests.find(r => r.input.prompt === 'stream')
    assert.deepEqual(request.input, { prompt:'stream', model:'mock-image', size:'2048x1152', n:2, stream:true, partial_images:3, quality:'max', background:'transparent', output_format:'webp', output_compression:70, moderation:'low' })
    assert.equal(request.headers.authorization,'Bearer secret-key'); assert.equal(request.headers['openai-organization'],'org-test'); assert.equal(request.headers['x-test'],'secret-header')
    const batch = await ok(home, ['batch','--input','-','--wait'], JSON.stringify([{ mode:'generate',prompt:'dataurl',params:{sizeMode:'auto'} },{ mode:'generate',prompt:'batch custom',params:{sizeMode:'custom',customW:1025,customH:1024} }]))
    assert.equal(batch.length, 2); assert.equal(batch[1].size,'1024x1024')
    assert.equal((await cli(home, ['generate','--prompt','bad','--n','11'])).code, 2)
    assert.equal((await cli(home, ['generate','--prompt','bad','--quality','unknown'])).code, 2)
    assert.equal((await cli(home, ['generate','--prompt','bad','--size','100x100'])).code, 2)
  })
  await t.test('reference snapshots, mask and edit fidelity', async () => {
    const image = join(root,'参考.png'), mask = join(root,'蒙版.png'); await writeFile(image,png); await writeFile(mask,png)
    const job = await ok(home, ['edit','--prompt','edit','--image',image,'--image',image,'--mask',mask,'--fidelity','low','--wait'])
    const request = requests.find(r => r.input.prompt === 'edit')
    assert.equal(request.path,'/v1/images/edits'); assert.equal(request.input.imageCount,2); assert.equal(request.input.input_fidelity,'low'); assert.equal(request.input.mask.type,'image/png')
    await rm(image); assert.deepEqual(await readFile(job.images[0]), png)
  })
  await t.test('absolute relay endpoint preserves relay headers', async () => {
    await ok(home,['generate','--prompt','relay','--relay-url',base.replace('/v1','/api/relay'),'--wait'])
    const relay = requests.find(r => r.input.prompt === 'relay')
    assert.equal(relay.path,'/api/relay'); assert.equal(relay.headers['x-relay-url'],`${base}/images/generations`)
    assert.equal(relay.headers['x-relay-organization'],'org-test'); assert.deepEqual(JSON.parse(relay.headers['x-relay-headers']),{'X-Test':'secret-header'})
  })
  await t.test('invalid batch and wait options do not submit tasks', async () => {
    const before = (await ok(home,['jobs','list'])).length
    assert.equal((await cli(home,['batch','--input','-'],JSON.stringify([{mode:'generate',prompt:'must not submit'},{mode:'generate',prompt:'bad',params:{n:11}}]))).code,2)
    assert.equal((await cli(home,['generate','--prompt','must not submit','--wait','--wait-timeout','-1'])).code,2)
    assert.equal((await ok(home,['jobs','list'])).length,before)
  })
  await t.test('download retry uses saved response, never regenerates', async () => {
    const initial = await cli(home, ['generate','--prompt','url','--wait'])
    assert.equal(initial.code,1); const failed = initial.result.data
    assert.equal(failed.error.phase,'download'); assert.equal(urlHits,3)
    const generationCount = requests.filter(r => r.input.prompt === 'url').length
    failDownloads = false
    const retried = await ok(home, ['jobs','retry',failed.id,'--wait'])
    assert.equal(retried.parentId, failed.id); assert.equal(retried.files.length,1)
    assert.equal(requests.filter(r => r.input.prompt === 'url').length,generationCount)
    assert.equal((await readdir(retried.outputDir)).some(p => p.endsWith('.part')),false)
  })
  await t.test('generation failure never automatically retries and errors redact credentials', async () => {
    const response = await cli(home, ['generate','--prompt','error','--wait'])
    assert.equal(response.code,1); assert.equal(response.stdout.includes('secret-key'),false); assert.equal(response.stdout.includes('secret-header'),false)
    assert.equal(requests.filter(r => r.input.prompt === 'error').length,1)
  })
  await t.test('cancel during download then retry reuses generation response', async () => {
    const job = await ok(home,['generate','--prompt','cancel-download'])
    await until(async () => (await ok(home,['jobs','show',job.id])).status === 'downloading')
    await ok(home,['jobs','cancel',job.id])
    await until(async () => (await ok(home,['worker','status'])).active === 0)
    assert.equal((await ok(home,['jobs','retry',job.id,'--wait'])).status,'succeeded')
    assert.equal(requests.filter(r => r.input.prompt === 'cancel-download').length,1)
  })
  await t.test('download recovery skips saved files even when source URL expired', async () => {
    const job = await ok(home,['generate','--prompt','resume-download','--n','2'])
    await until(async () => (await ok(home,['jobs','show',job.id])).files.length === 1)
    const status = await ok(home,['worker','status']); process.kill(status.pid,'SIGKILL'); await delay(200)
    const result = await ok(home,['jobs','wait',job.id])
    assert.equal(result.status,'succeeded'); assert.equal(result.files.length,2); assert.equal(onceHits,1)
    assert.equal(requests.filter(r => r.input.prompt === 'resume-download').length,1)
  })
  await t.test('web config import preserves key; export omits secrets', async () => {
    await ok(home, ['config','import','--input','-','--profile','mock'], JSON.stringify({ settings:{ baseUrl:base, model:'imported',apiKey:'replacement',useProxy:true },params:{quality:'high'} }))
    const job = await ok(home, ['generate','--prompt','import','--wait']); assert.equal(job.settings.model,'imported')
    assert.equal(requests.at(-1).headers.authorization,'Bearer secret-key')
    const path = join(root,'export.json'); await ok(home, ['config','export','--output',path]); assert.equal((await readFile(path,'utf8')).includes('secret-key'),false)
  })
  await t.test('explicit download retry copies completed files instead of fetching expired URLs', async () => {
    onceHits = 0; failDownloads = true
    const failed = await cli(home,['generate','--prompt','partial-retry','--n','2','--wait'])
    assert.equal(failed.code,1); assert.equal(failed.result.data.files.length,1)
    failDownloads = false
    const retried = await ok(home,['jobs','retry',failed.result.data.id,'--wait'])
    assert.equal(retried.files.length,2); assert.equal(onceHits,1)
    assert.equal(requests.filter(r => r.input.prompt === 'partial-retry').length,1)
  })
  await t.test('timeout only exits waiter; cancel aborts running and queued jobs', async () => {
    await ok(home,['config','set','--concurrency','1'])
    const first = await ok(home,['generate','--prompt','hold cancel'])
    const second = await ok(home,['generate','--prompt','never sent'])
    const wait = await cli(home,['jobs','wait',first.id,'--wait-timeout','0.1']); assert.equal(wait.code,3)
    assert.equal((await ok(home,['jobs','cancel',second.id])).status,'cancelled')
    await ok(home,['jobs','cancel',first.id]); await until(async () => (await ok(home,['worker','status'])).active === 0)
    assert.equal(requests.some(r => r.input.prompt === 'never sent'),false)
  })
  await t.test('queued credentials remain bound to original endpoint and key', async () => {
    const hold = await ok(home,['generate','--prompt','hold credential'])
    const queued = await ok(home,['generate','--prompt','credential snapshot'])
    await ok(home,['profile','set','mock','--api-key','replacement-key'])
    await ok(home,['jobs','wait',hold.id]); await ok(home,['jobs','wait',queued.id])
    assert.equal(requests.find(r => r.input.prompt === 'credential snapshot').headers.authorization,'Bearer secret-key')
    await ok(home,['profile','set','mock','--api-key','secret-key'])
    assert.equal((await readFile(join(home,'jobs',queued.id,'job.json'),'utf8')).includes('secret-key'),false)
  })
  await t.test('generation timeout fails once without resubmission', async () => {
    await ok(home,['config','set','--generation-timeout','1'])
    const result = await cli(home,['generate','--prompt','hold timeout','--wait'])
    assert.equal(result.code,1); assert.equal(result.result.data.error.phase,'generation')
    assert.equal(requests.filter(r => r.input.prompt === 'hold timeout').length,1)
    await ok(home,['config','set','--generation-timeout','600'])
  })
  await t.test('worker crash retains queue, interrupts uncertain requests, explicit retry works', async () => {
    const first = await ok(home,['generate','--prompt','hold crash'])
    await until(() => requests.some(r => r.input.prompt === 'hold crash'))
    const queued = await ok(home,['generate','--prompt','after crash'])
    const status = await ok(home,['worker','status']); process.kill(status.pid,'SIGKILL')
    await delay(200)
    const recovered = await Promise.all(Array.from({ length:8 }, () => ok(home,['worker','start'])))
    assert.equal(new Set(recovered.map(s => s.pid)).size, 1)
    assert.equal((await ok(home,['jobs','show',first.id])).status,'interrupted')
    assert.equal((await ok(home,['jobs','wait',queued.id])).status,'succeeded')
    assert.equal(requests.filter(r => r.input.prompt === 'hold crash').length,1)
    const retry = await ok(home,['jobs','retry',first.id,'--wait']); assert.equal(retry.parentId,first.id)
    assert.equal(requests.filter(r => r.input.prompt === 'hold crash').length,2)
  })
  await t.test('environment keys become available on explicit worker restart', async () => {
    await ok(home,['profile','set','env','--base-url',base,'--model','env-model','--api-key-env','HUITU_TEST_KEY'])
    await ok(home,['worker','restart'],undefined,{ HUITU_TEST_KEY:'env-secret' })
    await ok(home,['generate','--profile','env','--prompt','env','--wait'])
    assert.equal(requests.at(-1).headers.authorization,'Bearer env-secret')
  })
})
