import { X } from '@phosphor-icons/react'
import type { PrintRecord } from '../types'

interface Props {
  items: PrintRecord[]
  currentId: string | null
  onPick: (item: PrintRecord) => void
  onDelete: (id: string) => void
}

export function HistoryRail({ items, currentId, onPick, onDelete }: Props) {
  return (
    <aside className="rail">
      <div className="rail-head">底片 {items.length}</div>
      {items.length === 0 && <p className="okhint">暂无</p>}
      {items.map((item) => (
        <div key={item.id} className={`strip ${item.id === currentId ? 'is-on' : ''}`}>
          <button type="button" onClick={() => onPick(item)} title={item.prompt.slice(0, 80)}>
            <img src={item.dataUrl} alt="" />
          </button>
          <button
            type="button"
            className="kill icon-btn"
            aria-label="删除"
            onClick={(e) => {
              e.stopPropagation()
              onDelete(item.id)
            }}
          >
            <X size={12} />
          </button>
        </div>
      ))}
    </aside>
  )
}
