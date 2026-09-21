import { Check, DownloadSimple, UploadSimple, X } from '@phosphor-icons/react'
import { useRef, useState } from 'react'
import { testRelay } from '../lib/api'
import { describeError } from '../lib/errors'
import { exportConfig, importConfig } from '../lib/storage'
import type { Params, Settings } from '../types'

const MODELS = [
  'gpt-image-2.5-sunburst',
  'gpt-image-2.5-sunburst-2026-09-08',
  'gpt-image-2.5-flare',
  'gpt-image-2.5-flare-2026-09-08',
  'gpt-image-2',
]

interface Props {
  settings: Settings
  params: Params
  onChange: (next: Settings) => void
  onParams: (next: Params) => void
  onClose: () => void
  onClearHistory: () => void
}

export function SettingsDrawer({ settings, params, onChange, onParams, onClose, onClearHistory }: Props) {
  const [probe, setProbe] = useState('')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  function patch(part: Partial<Settings>) {
    onChange({ ...settings, ...part })
  }

  async function probeNow() {
    setBusy(true)
    setProbe('探测中…')
    try {
      setProbe(await testRelay(settings))
    } catch (err) {
      setProbe(describeError(err))
    } finally {
      setBusy(false)
    }
  }

  function downloadConfig() {
    const blob = new Blob([exportConfig(settings, params)], { type: 'application/json' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = 'huitu-config.json'
    a.click()
    URL.revokeObjectURL(a.href)
  }

  function onImport(file: File) {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const data = importConfig(String(reader.result))
        if (data.settings) onChange({ ...settings, ...data.settings, apiKey: settings.apiKey })
        if (data.params) onParams({ ...params, ...data.params })
        setProbe('配置已导入，密钥未覆盖')
      } catch (err) {
        setProbe(describeError(err))
      }
    }
    reader.readAsText(file)
  }

  return (
    <div className="drawer-back" onClick={onClose} role="presentation">
      <aside className="drawer" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="中转站">
        <div className="mark" style={{ justifyContent: 'space-between' }}>
          <h2>中转站</h2>
          <button className="icon-btn" type="button" onClick={onClose} aria-label="关闭">
            <X size={16} />
          </button>
        </div>
        <div className="field">
          <label htmlFor="baseUrl">接口根地址</label>
          <input
            id="baseUrl"
            value={settings.baseUrl}
            onChange={(e) => patch({ baseUrl: e.target.value.trim() })}
            placeholder="https://api.openai.com/v1"
            autoComplete="off"
          />
          <span className="okhint">填到 /v1 这一级。出图走 /images/generations，改图走 /images/edits。</span>
        </div>
        <form
          className="field"
          onSubmit={(e) => {
            e.preventDefault()
            void probeNow()
          }}
        >
          <label htmlFor="apiKey">密钥</label>
          <input
            id="apiKey"
            type="password"
            value={settings.apiKey}
            onChange={(e) => patch({ apiKey: e.target.value.trim() })}
            placeholder="sk-…"
            autoComplete="off"
          />
        </form>
        <div className="field">
          <label htmlFor="model">模型名</label>
          <input id="model" value={settings.model} onChange={(e) => patch({ model: e.target.value.trim() })} />
          <div className="chips">
            {MODELS.map((m) => (
              <button key={m} className={`chip ${settings.model === m ? 'is-on' : ''}`} type="button" onClick={() => patch({ model: m })}>
                {m.replace('gpt-image-', '')}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="org">组织号（可选）</label>
          <input id="org" value={settings.organization} onChange={(e) => patch({ organization: e.target.value.trim() })} />
        </div>
        <label className="chip" style={{ width: 'fit-content' }}>
          <input
            type="checkbox"
            checked={settings.useProxy}
            onChange={(e) => patch({ useProxy: e.target.checked })}
          />
          同源代理（避开浏览器跨域）
        </label>
        <div className="field">
          <label htmlFor="headers">额外请求头 JSON</label>
          <textarea
            id="headers"
            value={settings.extraHeaders}
            onChange={(e) => patch({ extraHeaders: e.target.value })}
            placeholder='{"X-Custom":"value"}'
          />
        </div>
        <div className="row">
          <button className="text-btn" type="button" onClick={() => void probeNow()} disabled={busy}>
            <Check size={14} /> 探测连通
          </button>
          <button className="text-btn" type="button" onClick={downloadConfig}>
            <DownloadSimple size={14} /> 导出配置
          </button>
          <button className="text-btn" type="button" onClick={() => fileRef.current?.click()}>
            <UploadSimple size={14} /> 导入配置
          </button>
        </div>
        {probe && <p className="okhint">{probe}</p>}
        <button className="text-btn" type="button" onClick={onClearHistory}>
          清空底片
        </button>
        <input
          ref={fileRef}
          className="hidden-file"
          type="file"
          accept="application/json"
          onChange={(e) => {
            const f = e.target.files?.[0]
            if (f) onImport(f)
            e.target.value = ''
          }}
        />
      </aside>
    </div>
  )
}
