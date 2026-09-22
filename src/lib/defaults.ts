import type { Params, Settings } from '../types.js'

export const defaultSettings = (): Settings => ({
  baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-image-2.5-sunburst',
  useProxy: true, extraHeaders: '', organization: '',
})

export const defaultParams = (): Params => ({
  quality: 'auto', background: 'auto', format: 'png', compression: 100,
  moderation: 'auto', fidelity: 'high', stream: false, partialImages: 2, n: 1,
  sizeMode: 'preset', sizePreset: '1024x1024', aspect: '1:1', longEdge: 1024,
  customW: 1024, customH: 1024,
})
