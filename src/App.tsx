import {
  Copy,
  DownloadSimple,
  Drop,
  GearSix,
  Image as ImageIcon,
  PaintBrush,
  Plus,
  Stop,
  UploadSimple,
} from '@phosphor-icons/react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { HistoryRail } from './components/HistoryRail'
import { MaskPad } from './components/MaskPad'
import { SettingsDrawer } from './components/SettingsDrawer'
import { editImage, generateImage } from './lib/api'
import { clearPrints, deletePrint, listPrints, putPrint } from './lib/db'
import { describeError } from './lib/errors'
import {
  dataUrlToBlob,
  fileOk,
  stampName,
  uid,
  usageLine,
} from './lib/format'
import { ASPECTS, LONG_EDGES, resolveSize, sheetRatio, SIZE_PRESETS, validateSize } from './lib/size'
import { loadParams, loadSettings, saveParams, saveSettings } from './lib/storage'
import type { GenImage, Mode, Params, PrintRecord, Quality, RefImage, Settings, ToastItem } from './types'

const QUALITIES: Quality[] = ['auto', 'low', 'medium', 'high', 'xhigh', 'max']
const TEMPLATES = [
  { id: 'still', label: '静物', text: '工作室静物摄影，单一主体居中，侧光，浅灰背景，无文字，无多余物体。' },
  { id: 'poster', label: '海报', text: '印刷海报，大标题清晰可读，留白克制，构图稳定，适合近看文字。' },
  { id: 'portrait', label: '人像', text: '自然光人像，皮肤质感真实，景深浅，表情放松，无畸变。' },
  { id: 'scene', label: '场景', text: '宽场景概念图，空间层次清楚，材质可辨，光线有方向。' },
  { id: 'ui', label: '界面', text: '产品界面截图风格，像素锐利，文字可读，无乱码。' },
  { id: 'macro', label: '材质', text: '材质特写，微距，表面细节丰富，照明均匀。' },
]

function dataUrlToFile(dataUrl: string, name: string): File {
  const blob = dataUrlToBlob(dataUrl)
  return new File([blob], name, { type: blob.type || 'image/png' })
}

export default function App() {
  const [settings, setSettings] = useState<Settings>(() => loadSettings())
  const [params, setParams] = useState<Params>(() => loadParams())
  const [mode, setMode] = useState<Mode>('generate')
  const [prompt, setPrompt] = useState('')
  const [openSet, setOpenSet] = useState(false)
  const [prints, setPrints] = useState<PrintRecord[]>([])
  const [current, setCurrent] = useState<PrintRecord | null>(null)
  const [variants, setVariants] = useState<GenImage[]>([])
  const [variantI, setVariantI] = useState(0)
  const [refs, setRefs] = useState<RefImage[]>([])
  const [mask, setMask] = useState<Blob | null>(null)
  const [showMask, setShowMask] = useState(false)
  const [compare, setCompare] = useState(false)
  const [split, setSplit] = useState(50)
  const [running, setRunning] = useState(false)
  const [partial, setPartial] = useState<string | null>(null)
  const [toasts, setToasts] = useState<ToastItem[]>([])
  const [over, setOver] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    saveSettings(settings)
  }, [settings])
  useEffect(() => {
    saveParams(params)
  }, [params])
  useEffect(() => {
    void listPrints().then(setPrints)
  }, [])

  const size = useMemo(() => resolveSize(params), [params])
  const sizeCheck = useMemo(() => validateSize(size), [size])
  const ready = Boolean(settings.baseUrl && settings.apiKey && settings.model)
  const frame = partial || variants[variantI]?.dataUrl || current?.dataUrl || null
  const ratio = sheetRatio(size === 'auto' && current ? current.size : size)

  const toast = useCallback((kind: ToastItem['kind'], text: string) => {
    const id = uid()
    setToasts((xs) => [...xs, { id, kind, text }])
    window.setTimeout(() => setToasts((xs) => xs.filter((t) => t.id !== id)), 4200)
  }, [])

  function patchParams(part: Partial<Params>) {
    setParams((p) => ({ ...p, ...part }))
  }

  function addFiles(files: FileList | File[]) {
    const next: RefImage[] = []
    for (const file of Array.from(files)) {
      const err = fileOk(file)
      if (err) {
        toast('err', err)
        continue
      }
      next.push({ id: uid(), file, url: URL.createObjectURL(file) })
    }
    setRefs((xs) => {
      const merged = [...xs, ...next].slice(0, 16)
      if (xs.length + next.length > 16) toast('info', '最多 16 张参考图')
      return merged
    })
    if (next.length) setMode('edit')
  }

  function removeRef(id: string) {
    setRefs((xs) => {
      const hit = xs.find((x) => x.id === id)
      if (hit) URL.revokeObjectURL(hit.url)
      return xs.filter((x) => x.id !== id)
    })
  }

  async function persist(resultImages: GenImage[], usedPrompt: string, usedSize: string) {
    const records: PrintRecord[] = []
    for (const img of resultImages) {
      const rec: PrintRecord = {
        id: uid(),
        createdAt: Date.now(),
        mode,
        prompt: usedPrompt,
        model: settings.model,
        size: usedSize,
        quality: params.quality,
        background: params.background,
        format: params.format,
        n: params.n,
        dataUrl: img.dataUrl,
      }
      records.push(rec)
      await putPrint(rec)
    }
    setPrints(await listPrints())
    setCurrent(records[0] ?? null)
  }

  async function expose() {
    if (running) return
    const text = prompt.trim()
    if (!text) {
      toast('err', '先写配方')
      return
    }
    if (text.length > 32000) {
      toast('err', '配方超过 32000 字')
      return
    }
    if (!sizeCheck.ok) {
      toast('err', sizeCheck.message)
      return
    }
    let images = refs.map((r) => r.file)
    if (mode === 'edit' && images.length === 0 && frame) {
      images = [dataUrlToFile(frame, 'plate.png')]
    }
    if (mode === 'edit' && images.length === 0) {
      toast('err', '改图需要底图，拖一张进来或先出图')
      return
    }
    if (!ready) {
      setOpenSet(true)
      toast('info', '先接通中转站')
      return
    }
    const ctrl = new AbortController()
    abortRef.current = ctrl
    setRunning(true)
    setPartial(null)
    try {
      const body = {
        prompt: text,
        model: settings.model,
        size,
        quality: params.quality,
        n: params.n,
        background: params.background,
        output_format: params.format,
        output_compression: params.compression,
        moderation: params.moderation,
        stream: params.stream,
        partial_images: params.partialImages,
      }
      const result =
        mode === 'edit'
          ? await editImage(
              settings,
              { ...body, images, mask, input_fidelity: params.fidelity },
              { signal: ctrl.signal, onPartial: setPartial },
            )
          : await generateImage(settings, body, { signal: ctrl.signal, onPartial: setPartial })
      setVariants(result.images)
      setVariantI(0)
      setPartial(null)
      await persist(result.images, text, result.size || size)
      const line = usageLine(result.usage)
      toast('ok', line ? `成片 · ${line}` : '成片')
    } catch (err) {
      toast('err', describeError(err))
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }

  function download() {
    const url = frame
    if (!url) return
    const a = document.createElement('a')
    a.href = url
    a.download = stampName('huitu', size, params.format)
    a.click()
  }

  async function copyImg() {
    if (!frame) return
    try {
      const blob = dataUrlToBlob(frame)
      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })])
      toast('ok', '已复制到剪贴板')
    } catch {
      toast('err', '复制失败，改用下载')
    }
  }

  function pickPrint(item: PrintRecord) {
    setCurrent(item)
    setVariants([{ dataUrl: item.dataUrl }])
    setVariantI(0)
    setPrompt(item.prompt)
    setPartial(null)
  }

  async function dropPrint(id: string) {
    await deletePrint(id)
    setPrints(await listPrints())
    if (current?.id === id) setCurrent(null)
  }

  async function wipeHistory() {
    await clearPrints()
    setPrints([])
    setCurrent(null)
    toast('ok', '底片已清空')
  }

  function fallPlate() {
    if (!frame) return
    const file = dataUrlToFile(frame, 'plate.png')
    setRefs((xs) => [{ id: uid(), file, url: URL.createObjectURL(file) }, ...xs].slice(0, 16))
    setMode('edit')
    toast('info', '当前片已落成底图')
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const meta = e.ctrlKey || e.metaKey
      if (meta && e.key === 'Enter') {
        e.preventDefault()
        void expose()
      }
      if (e.key === 'Escape') {
        if (openSet) setOpenSet(false)
        else abortRef.current?.abort()
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault()
        download()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  useEffect(() => {
    function onPaste(e: ClipboardEvent) {
      const items = e.clipboardData?.files
      if (items && items.length) addFiles(items)
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  })

  const maskSrc = refs[0]?.url || frame

  return (
    <div className="app">
      <div className="grain" />
      <header className="top">
        <div className="mark">
          <span className="mark-sun" aria-hidden />
          <div className="word">
            绘途
            <small>蓝晒工坊</small>
          </div>
        </div>
        <div className="top-status">
          <span className={`dot ${ready ? 'on' : ''}`} />
          <span className="model-name">{ready ? settings.model : '未接通'}</span>
          <button className="text-btn settings-btn" type="button" onClick={() => setOpenSet(true)}>
            <GearSix size={16} /> <span className="btn-label">中转站</span>
          </button>
        </div>
      </header>

      <HistoryRail items={prints} currentId={current?.id ?? null} onPick={pickPrint} onDelete={(id) => void dropPrint(id)} />

      <main className="stage">
        <div
          className="sheet-wrap"
          onDragOver={(e) => {
            e.preventDefault()
            setOver(true)
          }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setOver(false)
            if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files)
          }}
        >
          <div
            className={`sheet ${params.background === 'transparent' ? 'is-trans' : ''} ${running ? 'bleach' : ''}`}
            style={{ ['--sheet-ratio' as string]: String(ratio) }}
          >
            {frame ? (
              compare && refs[0] ? (
                <div className="compare" style={{ ['--split' as string]: `${split}%` }}>
                  <img src={refs[0].url} alt="" />
                  <img className="after" src={frame} alt="" />
                  <input
                    className="compare-range"
                    type="range"
                    min={0}
                    max={100}
                    value={split}
                    onChange={(e) => setSplit(Number(e.target.value))}
                  />
                </div>
              ) : (
                <img className="frame" src={frame} alt="当前成片" />
              )
            ) : (
              <div className="watermark">
                <div>
                  <h1>等待曝光</h1>
                  <p>{over ? '松开即作底图' : '配方写在下面，日光从右下角来'}</p>
                </div>
              </div>
            )}
            {running && <div className="busy">{partial ? '显影中' : '曝光中'}</div>}
            {variants.length > 1 && (
              <div className="variants">
                {variants.map((v, i) => (
                  <button key={v.dataUrl + i} className={i === variantI ? 'is-on' : ''} type="button" onClick={() => setVariantI(i)}>
                    <img src={v.dataUrl} alt="" />
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="prompt-dock">
          <div>
            <div className="chips">
              {TEMPLATES.map((t) => (
                <button key={t.id} className="chip" type="button" onClick={() => setPrompt(t.text)}>
                  {t.label}
                </button>
              ))}
            </div>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="配方。写主体、光线、背景、不要什么。Ctrl+Enter 曝光。"
              maxLength={32000}
            />
            <div className="prompt-meta">
              <span>{mode === 'edit' ? '水洗' : '出图'}</span>
              <span>{prompt.length} / 32000</span>
            </div>
          </div>
          <div className="sun-wrap">
            <button
              className={`sun ${running ? 'is-hot' : ''}`}
              type="button"
              onClick={() => void expose()}
              disabled={running}
            >
              {mode === 'edit' ? '水洗' : '曝光'}
            </button>
            {running && (
              <button className="text-btn abort" type="button" onClick={() => abortRef.current?.abort()}>
                <Stop size={14} /> 中止
              </button>
            )}
          </div>
        </div>
      </main>

      <aside className="console">
        <div className="tray">
          <h2>工序</h2>
          <div className="seg">
            <button className={mode === 'generate' ? 'is-on' : ''} type="button" onClick={() => setMode('generate')}>
              出图
            </button>
            <button className={mode === 'edit' ? 'is-on' : ''} type="button" onClick={() => setMode('edit')}>
              改图
            </button>
          </div>
        </div>

        <div className="tray">
          <h2>画幅</h2>
          <div className="seg">
            {(['preset', 'aspect', 'custom', 'auto'] as const).map((m) => (
              <button key={m} className={params.sizeMode === m ? 'is-on' : ''} type="button" onClick={() => patchParams({ sizeMode: m })}>
                {m === 'preset' ? '常用' : m === 'aspect' ? '比例' : m === 'custom' ? '自定义' : '自动'}
              </button>
            ))}
          </div>
          {params.sizeMode === 'preset' && (
            <div className="chips">
              {SIZE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  className={`chip ${params.sizePreset === p.size ? 'is-on' : ''}`}
                  type="button"
                  onClick={() => patchParams({ sizePreset: p.size })}
                >
                  {p.label}
                </button>
              ))}
            </div>
          )}
          {params.sizeMode === 'aspect' && (
            <>
              <div className="chips">
                {ASPECTS.map((a) => (
                  <button
                    key={a.id}
                    className={`chip ${params.aspect === a.id ? 'is-on' : ''}`}
                    type="button"
                    onClick={() => patchParams({ aspect: a.id })}
                  >
                    {a.id}
                  </button>
                ))}
              </div>
              <div className="chips">
                {LONG_EDGES.map((n) => (
                  <button
                    key={n}
                    className={`chip ${params.longEdge === n ? 'is-on' : ''}`}
                    type="button"
                    onClick={() => patchParams({ longEdge: n })}
                  >
                    长边 {n}
                  </button>
                ))}
              </div>
            </>
          )}
          {params.sizeMode === 'custom' && (
            <div className="row">
              <label className="field" style={{ flex: 1 }}>
                <span>宽</span>
                <input
                  type="number"
                  min={16}
                  max={3840}
                  step={16}
                  value={params.customW}
                  onChange={(e) => patchParams({ customW: Number(e.target.value) })}
                />
              </label>
              <label className="field" style={{ flex: 1 }}>
                <span>高</span>
                <input
                  type="number"
                  min={16}
                  max={3840}
                  step={16}
                  value={params.customH}
                  onChange={(e) => patchParams({ customH: Number(e.target.value) })}
                />
              </label>
            </div>
          )}
          {sizeCheck.ok ? <span className="okhint">{size}</span> : <span className="hint">{sizeCheck.message}</span>}
        </div>

        <div className="tray">
          <h2>感光</h2>
          <div className="chips">
            {QUALITIES.map((q) => (
              <button key={q} className={`chip ${params.quality === q ? 'is-on' : ''}`} type="button" onClick={() => patchParams({ quality: q })}>
                {q}
              </button>
            ))}
          </div>
          <div className="row">
            <label className="field" style={{ flex: 1 }}>
              <span>张数 {params.n}</span>
              <input type="range" min={1} max={10} value={params.n} onChange={(e) => patchParams({ n: Number(e.target.value) })} />
            </label>
          </div>
        </div>

        <div className="tray">
          <h2>输出</h2>
          <div className="seg">
            {(['auto', 'opaque', 'transparent'] as const).map((b) => (
              <button key={b} className={params.background === b ? 'is-on' : ''} type="button" onClick={() => patchParams({ background: b })}>
                {b === 'auto' ? '底自动' : b === 'opaque' ? '不透明' : '透明底'}
              </button>
            ))}
          </div>
          <div className="seg">
            {(['png', 'webp', 'jpeg'] as const).map((f) => (
              <button key={f} className={params.format === f ? 'is-on' : ''} type="button" onClick={() => patchParams({ format: f })}>
                {f}
              </button>
            ))}
          </div>
          {params.format !== 'png' && (
            <label className="field">
              <span>压缩 {params.compression}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={params.compression}
                onChange={(e) => patchParams({ compression: Number(e.target.value) })}
              />
            </label>
          )}
          <div className="seg">
            {(['auto', 'low'] as const).map((m) => (
              <button key={m} className={params.moderation === m ? 'is-on' : ''} type="button" onClick={() => patchParams({ moderation: m })}>
                审核 {m}
              </button>
            ))}
          </div>
          <label className="chip" style={{ width: 'fit-content' }}>
            <input type="checkbox" checked={params.stream} onChange={(e) => patchParams({ stream: e.target.checked })} />
            流式显影
          </label>
          {params.stream && (
            <label className="field">
              <span>中间帧 {params.partialImages}</span>
              <input
                type="range"
                min={0}
                max={3}
                value={params.partialImages}
                onChange={(e) => patchParams({ partialImages: Number(e.target.value) })}
              />
            </label>
          )}
        </div>

        {mode === 'edit' && (
          <div className="tray">
            <h2>底图</h2>
            <div className="seg">
              {(['high', 'low'] as const).map((f) => (
                <button key={f} className={params.fidelity === f ? 'is-on' : ''} type="button" onClick={() => patchParams({ fidelity: f })}>
                  保真 {f === 'high' ? '高' : '低'}
                </button>
              ))}
            </div>
            <div
              className={`drop ${over ? 'is-over' : ''}`}
              onClick={() => fileRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault()
                setOver(true)
              }}
              onDrop={(e) => {
                e.preventDefault()
                setOver(false)
                addFiles(e.dataTransfer.files)
              }}
            >
              <UploadSimple size={18} />
              拖入 / 粘贴 / 点击，最多 16 张
            </div>
            <div className="refs">
              {refs.map((r) => (
                <div className="ref" key={r.id}>
                  <img src={r.url} alt="" />
                  <button className="kill icon-btn" type="button" onClick={() => removeRef(r.id)} aria-label="移除">
                    ×
                  </button>
                </div>
              ))}
            </div>
            <div className="row">
              <button className="text-btn" type="button" onClick={fallPlate} disabled={!frame}>
                <ImageIcon size={14} /> 当前片作底
              </button>
              <button className="text-btn" type="button" onClick={() => setShowMask((v) => !v)} disabled={!maskSrc}>
                <PaintBrush size={14} /> {showMask ? '收起蒙版' : '涂蒙版'}
              </button>
              <button className="text-btn" type="button" onClick={() => setCompare((v) => !v)} disabled={!frame || !refs[0]}>
                对照
              </button>
            </div>
            {showMask && maskSrc && <MaskPad src={maskSrc} onMask={setMask} />}
          </div>
        )}

        <div className="tray">
          <h2>定影</h2>
          <div className="row">
            <button className="text-btn" type="button" onClick={download} disabled={!frame}>
              <DownloadSimple size={14} /> 下载
            </button>
            <button className="text-btn" type="button" onClick={() => void copyImg()} disabled={!frame}>
              <Copy size={14} /> 复制
            </button>
            <button className="text-btn" type="button" onClick={() => fileRef.current?.click()}>
              <Plus size={14} /> 加图
            </button>
          </div>
        </div>

        <p className="usage">
          <Drop size={12} /> {settings.model} · {size}
        </p>
      </aside>

      <input
        ref={fileRef}
        className="hidden-file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files)
          e.target.value = ''
        }}
      />

      {openSet && (
        <SettingsDrawer
          settings={settings}
          params={params}
          onChange={setSettings}
          onParams={setParams}
          onClose={() => setOpenSet(false)}
          onClearHistory={() => void wipeHistory()}
        />
      )}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
