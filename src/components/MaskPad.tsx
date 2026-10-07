import { Eraser, PaintBrush, Trash } from '@phosphor-icons/react'
import { useEffect, useRef, useState, type PointerEvent } from 'react'

interface Props {
  src: string
  onMask: (blob: Blob | null) => void
}

export function MaskPad({ src, onMask }: Props) {
  const viewRef = useRef<HTMLCanvasElement>(null)
  const maskRef = useRef<HTMLCanvasElement>(null)
  const overlayRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const onMaskRef = useRef(onMask)
  const [brush, setBrush] = useState(36)
  const [erase, setErase] = useState(false)
  const drawing = useRef(false)
  const revision = useRef(0)
  const loadRevision = useRef(0)
  const scheduled = useRef<number | null>(null)
  useEffect(() => { onMaskRef.current = onMask }, [onMask])

  function paint() {
    const view = viewRef.current
    const mask = maskRef.current
    const overlay = overlayRef.current
    const img = imgRef.current
    if (!view || !mask || !overlay || !img) return
    const ctx = view.getContext('2d')
    const octx = overlay.getContext('2d')
    if (!ctx || !octx) return
    ctx.clearRect(0, 0, view.width, view.height)
    ctx.drawImage(img, 0, 0)
    octx.clearRect(0, 0, overlay.width, overlay.height)
    octx.globalAlpha = 0.5
    octx.fillStyle = '#c45b3a'
    octx.fillRect(0, 0, overlay.width, overlay.height)
    octx.globalAlpha = 1
    octx.globalCompositeOperation = 'destination-out'
    octx.drawImage(mask, 0, 0)
    octx.globalCompositeOperation = 'source-over'
    ctx.drawImage(overlay, 0, 0)
  }

  useEffect(() => {
    const lifecycle = loadRevision
    const exportRevision = revision
    const frame = scheduled
    const version = ++loadRevision.current
    const img = new Image()
    img.onload = () => {
      if (loadRevision.current !== version) return
      imgRef.current = img
      const view = viewRef.current
      const mask = maskRef.current
      const overlay = overlayRef.current
      if (!view || !mask || !overlay) return
      view.width = img.width
      view.height = img.height
      mask.width = img.width
      mask.height = img.height
      overlay.width = img.width
      overlay.height = img.height
      const mctx = mask.getContext('2d')
      if (mctx) {
        mctx.fillStyle = '#fff'
        mctx.fillRect(0, 0, mask.width, mask.height)
      }
      paint()
      onMaskRef.current(null)
    }
    img.src = src
    return () => {
      lifecycle.current++
      exportRevision.current++
      img.onload = null
      drawing.current = false
      if (frame.current !== null) cancelAnimationFrame(frame.current)
      frame.current = null
    }
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
    const ctx = mask.getContext('2d')
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
    if (scheduled.current === null) scheduled.current = requestAnimationFrame(() => { scheduled.current = null; paint() })
  }

  function emit() {
    const mask = maskRef.current
    if (!mask) return
    const version = ++revision.current
    mask.toBlob((blob) => { if (revision.current === version) onMaskRef.current(blob) }, 'image/png')
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
    revision.current++
    const mask = maskRef.current
    if (!mask) return
    const ctx = mask.getContext('2d')
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
          onPointerCancel={onUp}
        />
        <canvas ref={maskRef} hidden />
        <canvas ref={overlayRef} hidden />
      </div>
    </div>
  )
}
