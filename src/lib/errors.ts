export function describeError(err: unknown): string {
  if (err instanceof DOMException && err.name === 'AbortError') return '已中止曝光'
  if (err instanceof Error && err.message) return err.message
  return '未知错误'
}

interface ApiErrShape {
  error?: {
    message?: string
    code?: string
    type?: string
    moderation_details?: { categories?: string[]; moderation_stage?: string }
  }
  message?: string
}

export function describeHttp(status: number, bodyText: string): string {
  let parsed: ApiErrShape | null = null
  try {
    parsed = JSON.parse(bodyText) as ApiErrShape
  } catch {
    parsed = null
  }
  const msg = parsed?.error?.message || parsed?.message || bodyText.slice(0, 280)
  const code = parsed?.error?.code
  if (code === 'moderation_blocked') {
    const cats = parsed?.error?.moderation_details?.categories?.join('、')
    return cats ? `审核拦截：${cats}` : '审核拦截，换一条配方再试'
  }
  if (status === 401) return msg || '密钥被拒绝，检查中转站与密钥'
  if (status === 403) return msg || '没有权限调用该模型'
  if (status === 404) return msg || '接口路径不对，确认地址填到 /v1'
  if (status === 413) return msg || '图片太大'
  if (status === 429) return msg || '触发限流，稍后再曝'
  if (status >= 500) return msg || `中转站 ${status}`
  return msg || `请求失败 ${status}`
}
