import { mkdir, readFile, writeFile, rename, readdir, realpath, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { randomUUID, createHash } from 'node:crypto'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { defaults, validateConfig } from './config.js'
import { CliError } from './types.js'
import type { Config, Job } from './types.js'

export async function homePath(input?: string) {
  const path = resolve(input || process.env.HUITU_HOME || join(homedir(), '.huitu'))
  await mkdir(path, { recursive: true, mode: 0o700 })
  return realpath(path)
}
export function endpoint(home: string) {
  const hash = createHash('sha256').update(process.platform === 'win32' ? home.toLowerCase() : home).digest('hex').slice(0, 24)
  return process.platform === 'win32' ? `\\\\.\\pipe\\huitu-${hash}` : join(tmpdir(), `huitu-${hash}.sock`)
}
export function jobDir(home: string, id: string) {
  if (!/^[0-9a-f-]{36}$/.test(id)) throw new CliError('Invalid job ID')
  return join(home, 'jobs', id)
}
const writes = new Map<string, Promise<void>>()
export async function atomicJson(path: string, value: unknown) {
  const body = JSON.stringify(value, null, 2)
  const previous = writes.get(path) ?? Promise.resolve()
  const current = previous.catch(() => undefined).then(async () => {
    const temp = `${path}.${randomUUID()}.tmp`
    try { await writeFile(temp, body, { mode: 0o600, flag: 'wx' }); await rename(temp, path) }
    finally { await rm(temp, { force: true }) }
  })
  writes.set(path, current)
  try { await current } finally { if (writes.get(path) === current) writes.delete(path) }
}
export async function readJson<T>(path: string): Promise<T> { return JSON.parse((await readFile(path, 'utf8')).replace(/^\uFEFF/, '')) as T }
export async function loadConfig(home: string): Promise<Config> {
  try { const config = await readJson<Config>(join(home, 'config.json')); validateConfig(config); return config }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return defaults(); throw error }
}
export async function loadJobs(home: string) {
  await mkdir(join(home, 'jobs'), { recursive: true, mode: 0o700 })
  const jobs: Job[] = []
  for (const entry of await readdir(join(home, 'jobs'))) {
    if (!/^[0-9a-f-]{36}$/.test(entry)) continue
    try { jobs.push(await readJson<Job>(join(jobDir(home, entry), 'job.json'))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
  }
  return jobs.sort((a, b) => a.sequence - b.sequence)
}
export async function claimLock(home: string) {
  // Kernel-owned lease: process death releases it atomically. No stale-file reclamation race.
  const identity = process.platform === 'win32' ? home.toLowerCase() : home
  const port = 20000 + createHash('sha256').update(identity).digest().readUInt32BE(0) % 40000
  const lease = createServer(socket => socket.destroy())
  const claimed = await new Promise<boolean>((resolve, reject) => {
    lease.once('error', (error: NodeJS.ErrnoException) => error.code === 'EADDRINUSE' ? resolve(false) : reject(error))
    lease.listen({ port, host: '127.0.0.1', exclusive: true }, () => resolve(true))
  })
  if (!claimed) { console.error(`Worker singleton lease unavailable on 127.0.0.1:${port}`); return null }
  return lease
}
