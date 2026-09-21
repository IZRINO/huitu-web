import { Eraser, PaintBrush, Trash } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Props {
  src: string
  onMask: (blob: Blob | null) => void
}

export function MaskPad({ src, onMask }: Props) {
  const viewRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const onMaskRef = useRef(onMask)
  const [brush, setBrush] = useState(36)
  const [erase, setErase] = useState(false)
  const drawing = useRef(false)
  onMaskRef.current = onMask

  function paint() {
    const view = viewRef.current
    const mask = maskRef.current
    const img = imgRef.current
    if (!view || !mask || !img) return
    const ctx = view.getContext('2d', { willReadFrequently: true })
    const mctx = mask.getContext('2d', { willReadFrequently: true })
    if (!ctx || !mctx) return
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(img, 0, 0)
    const data = mctx.getImageData(0, 0, mask.width, mask.height)
    const overlay = ctx.getImageData(0, 0, view.width, view.height)
    for (let i = 0; i < data.data.length; i += 4) {
      if (data.data[i + 3] < 16) {
        overlay.data[i] = Math.round(overlay.data[i] * 0.5 + 196 * 0.5)
        overlay.data[i + 1] = Math.round(overlay.data[i + 1] * 0.5 + 91 * 0.5)
        overlay.data[i + 2] = Math.round(overlay.data[i + 2] * 0.5 + 58 * 0.5)
      }
    }
    ctx.putImageData(overlay, 0, 0)
  }

  useEffect(() => {
    const img = new Image()
    img.onload = () => {
      imgRef.current = img
      const view = viewRef.current
      const mask = maskRef.current
      if (!view || !mask) return
      view.width = img.width
      view.height = img.height
      mask.width = img.width
      mask.height = img.height
      const mctx = mask.getContext('2d', { willReadFrequently: true })
      if (mctx) {
        mctx.fillStyle = '#fff'
        mctx.fillRect(0, 0, mask.width, mask.height)
      }
      paint()
      onMaskRef.current(null)
    }
    img.src = src
  }, [src])

  function pos(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = viewRef.current
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()
    return {
      x: ((e.clientX - r.left) / r.width) * canvas.width,
      y: ((e.clientY - r.top) / r.height) * canvas.height,
    }
  }

  function dab(x: number, y: number) {
    const mask = maskRef.current
    if (!mask) return
    const ctx = mask.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.beginPath()
    ctx.arc(x, y, brush, 0, Math.PI * 2)
    if (erase) {
      ctx.globalCompositeOperation = 'source-over'
      ctx.fillStyle = '#fff'
    } else {
      ctx.globalCompositeOperation = 'destination-out'
      ctx.fillStyle = '#000'
    }
    ctx.fill()
    ctx.globalCompositeOperation = 'source-over'
    paint()
  }

  function emit() {
    const mask = maskRef.current
    if (!mask) return
    mask.toBlob((blob) => onMaskRef.current(blob), 'image/png')
  }

  function onDown(e: PointerEvent<HTMLCanvasElement>) {
    drawing.current = true
    e.currentTarget.setPointerCapture(e.pointerId)
    const p = pos(e)
    if (p) dab(p.x, p.y)
  }
  function onMove(e: PointerEvent<HTMLCanvasElement>) {
    if (!drawing.current) return
    const p = pos(e)
    if (p) dab(p.x, p.y)
  }
  function onUp() {
    if (!drawing.current) return
    drawing.current = false
    emit()
  }

  function clear() {
    const mask = maskRef.current
    if (!mask) return
    const ctx = mask.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    ctx.globalCompositeOperation = 'source-over'
    ctx.fillStyle = '#fff'
    ctx.fillRect(0, 0, mask.width, mask.height)
    paint()
    onMaskRef.current(null)
  }

  return (
    <div>
      <div className="mask-tools">
        <button className={`chip ${erase ? '' : 'is-on'}`} type="button" onClick={() => setErase(false)}>
          <PaintBrush size={14} /> 涂改
        </button>
        <button className={`chip ${erase ? 'is-on' : ''}`} type="button" onClick={() => setErase(true)}>
          <Eraser size={14} /> 还原
        </button>
        <label className="field" style={{ minWidth: 120 }}>
          <span className="okhint">笔径 {brush}</span>
          <input type="range" min={8} max={120} value={brush} onChange={(e) => setBrush(Number(e.target.value))} />
        </label>
        <button className="text-btn" type="button" onClick={clear}>
          <Trash size={14} /> 清空
        </button>
      </div>
      <p className="okhint">透明处会被改写，未涂区域保持原样。</p>
      <div className="mask-stage">
        <canvas
          ref={viewRef}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
        />
        <canvas ref={maskRef} hidden />
      </div>
    </div>
  )
}
