import type { Params, Settings, Mode, Usage } from '../src/types.js'

export interface Profile {
  settings?: Partial<Settings>
  params?: Partial<Params>
  apiKeyEnv?: string
  outputDir?: string
}
export interface Config {
  version: 1
  concurrency: number
  outputDir: string
  generationTimeout: number
  downloadTimeout: number
  defaultProfile: string
  defaults: Profile
  profiles: Record<string, Profile>
}
export interface JobSpec extends Profile {
  mode: Mode
  prompt: string
  profile?: string
  images?: string[]
  mask?: string
}
export type Status = 'queued' | 'running' | 'downloading' | 'succeeded' | 'failed' | 'cancelled' | 'interrupted'
export interface Job {
  id: string
  sequence: number
  parentId?: string
  status: Status
  mode: Mode
  prompt: string
  profile: string
  settings: Settings
  apiKeyEnv?: string
  params: Params
  size: string
  images: string[]
  mask?: string
  outputDir: string
  generationTimeout: number
  downloadTimeout: number
  files: string[]
  usage?: Usage
  createdAt: string
  startedAt?: string
  finishedAt?: string
  error?: { code: string; message: string; phase: string }
}
export class CliError extends Error {
  constructor(message: string, public code = 'INVALID_ARGUMENT', public exitCode = 2) { super(message) }
}
export const terminal = (status: Status) => ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(status)
export const messageOf = (error: unknown) => error instanceof Error ? error.message : String(error)
