import type { Params, Settings } from '../types'

const SETTINGS_KEY = 'huitu.settings.v1'
const PARAMS_KEY = 'huitu.params.v1'

export const defaultSettings = (): Settings => ({
  baseUrl: 'https://api.openai.com/v1',
  apiKey: '',
  model: 'gpt-image-2.5-sunburst',
  useProxy: true,
  extraHeaders: '',
  organization: '',
})

export const defaultParams = (): Params => ({
  quality: 'auto',
  background: 'auto',
  format: 'png',
  compression: 100,
  moderation: 'auto',
  fidelity: 'high',
  stream: false,
  partialImages: 2,
  n: 1,
  sizeMode: 'preset',
  sizePreset: '1024x1024',
  aspect: '1:1',
  longEdge: 1024,
  customW: 1024,
  customH: 1024,
})

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return { ...fallback, ...JSON.parse(raw) }
  } catch {
    return fallback
  }
}

export function loadSettings(): Settings {
  return read(SETTINGS_KEY, defaultSettings())
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function loadParams(): Params {
  return read(PARAMS_KEY, defaultParams())
}

export function saveParams(p: Params): void {
  localStorage.setItem(PARAMS_KEY, JSON.stringify(p))
}

export function exportConfig(settings: Settings, params: Params): string {
  return JSON.stringify({ settings: { ...settings, apiKey: '' }, params }, null, 2)
}

export function importConfig(json: string): { settings?: Partial<Settings>; params?: Partial<Params> } {
  const data = JSON.parse(json) as { settings?: Partial<Settings>; params?: Partial<Params> }
  if (!data || typeof data !== 'object') throw new Error('配置不是对象')
  return data
}
