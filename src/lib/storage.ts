import type { Params, Settings } from '../types'
import { defaultParams, defaultSettings } from './defaults'
import { validateParams, validateSettings } from './validate'
export { defaultParams, defaultSettings } from './defaults'

const SETTINGS_KEY = 'huitu.settings.v1'
const PARAMS_KEY = 'huitu.params.v1'

function read<T>(key: string, fallback: T, validate: (value: unknown) => void): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    const value = JSON.parse(raw)
    validate(value)
    return { ...fallback, ...value }
  } catch {
    return fallback
  }
}

export function loadSettings(): Settings {
  return read(SETTINGS_KEY, defaultSettings(), validateSettings)
}

export function saveSettings(s: Settings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(s))
}

export function loadParams(): Params {
  return read(PARAMS_KEY, defaultParams(), validateParams)
}

export function saveParams(p: Params): void {
  localStorage.setItem(PARAMS_KEY, JSON.stringify(p))
}

export function exportConfig(settings: Settings, params: Params): string {
  return JSON.stringify({ settings: { ...settings, apiKey: '', relayToken: '', extraHeaders: '' }, params }, null, 2)
}

export function importConfig(json: string): { settings?: Partial<Settings>; params?: Partial<Params> } {
  const data = JSON.parse(json) as { settings?: Partial<Settings>; params?: Partial<Params> }
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('配置不是对象')
  if (data.settings !== undefined) validateSettings(data.settings)
  if (data.params !== undefined) validateParams(data.params)
  return data
}
