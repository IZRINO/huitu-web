import type { Params, Settings } from '../types.js'
import { defaultParams, defaultSettings } from './defaults.js'
import { ASPECTS, resolveSize, validateSize } from './size.js'
import { parseExtra } from './api.js'

function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('配置必须是对象')
}

export function validateSettings(value: unknown): asserts value is Partial<Settings> {
  object(value)
  const allowed = [...Object.keys(defaultSettings()), 'relayUrl', 'relayToken']
  for (const [key, field] of Object.entries(value)) {
    if (!allowed.includes(key)) throw new Error(`未知配置字段：${key}`)
    if (key === 'useProxy' ? typeof field !== 'boolean' : typeof field !== 'string') throw new Error(`配置字段类型错误：${key}`)
    if ((key === 'baseUrl' || key === 'relayUrl') && field) {
      const url = new URL(String(field), key === 'relayUrl' ? 'http://localhost' : undefined)
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('地址必须是无内嵌凭据的 HTTP(S) 地址')
    }
    if (key === 'extraHeaders') new Headers(parseExtra(String(field)))
  }
}

export function validateParams(value: unknown): asserts value is Partial<Params> {
  object(value)
  const choices: Record<string, readonly string[]> = {
    quality: ['auto', 'low', 'medium', 'high', 'xhigh', 'max'], background: ['auto', 'opaque', 'transparent'],
    format: ['png', 'webp', 'jpeg'], moderation: ['auto', 'low'], fidelity: ['high', 'low'],
    sizeMode: ['auto', 'preset', 'aspect', 'custom'], aspect: ASPECTS.map(aspect => aspect.id),
  }
  const defaults = defaultParams()
  for (const [key, field] of Object.entries(value)) {
    if (!Object.hasOwn(defaults, key)) throw new Error(`未知参数：${key}`)
    if (choices[key]) {
      if (typeof field !== 'string' || !choices[key].includes(field)) throw new Error(`参数值错误：${key}`)
    } else if (key === 'stream') {
      if (typeof field !== 'boolean') throw new Error('stream 必须为布尔值')
    } else if (key === 'sizePreset') {
      if (typeof field !== 'string' || !validateSize(field).ok) throw new Error('预设尺寸无效')
    } else {
      const [min, max] = key === 'n' ? [1, 10] : key === 'compression' ? [0, 100] : key === 'partialImages' ? [0, 3] : [16, 3840]
      if (!Number.isInteger(field) || Number(field) < min || Number(field) > max) throw new Error(`参数超出范围：${key}`)
    }
  }
  const check = validateSize(resolveSize({ ...defaults, ...value } as Params))
  if (!check.ok) throw new Error(check.message)
}
