export type Mode = 'generate' | 'edit'

export type Quality = 'auto' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Background = 'auto' | 'transparent' | 'opaque'
export type OutputFormat = 'png' | 'webp' | 'jpeg'
export type Moderation = 'auto' | 'low'
export type Fidelity = 'low' | 'high'

export interface Settings {
  baseUrl: string
  apiKey: string
  model: string
  useProxy: boolean
  relayUrl?: string
  extraHeaders: string
  organization: string
}

export interface Params {
  quality: Quality
  background: Background
  format: OutputFormat
  compression: number
  moderation: Moderation
  fidelity: Fidelity
  stream: boolean
  partialImages: number
  n: number
  sizeMode: 'auto' | 'preset' | 'aspect' | 'custom'
  sizePreset: string
  aspect: string
  longEdge: number
  customW: number
  customH: number
}

export interface Usage {
  input_tokens?: number
  output_tokens?: number
  total_tokens?: number
  input_tokens_details?: {
    text_tokens?: number
    image_tokens?: number
  }
}

export interface GenImage {
  dataUrl: string
  b64?: string
}

export interface GenResult {
  images: GenImage[]
  usage?: Usage
  size?: string
  quality?: string
  background?: string
  outputFormat?: string
}

export interface PrintRecord {
  id: string
  createdAt: number
  mode: Mode
  prompt: string
  model: string
  size: string
  quality: string
  background: string
  format: string
  n: number
  dataUrl: string
  usage?: Usage
}

export interface RefImage {
  id: string
  file: File
  url: string
}

export interface ToastItem {
  id: string
  kind: 'ok' | 'err' | 'info'
  text: string
}
