import { Images, X } from '@phosphor-icons/react'
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
      <div className="rail-head"><Images size={16} /><span>底片 <b>{items.length}</b></span></div>
      {items.length === 0 && <div className="rail-empty"><Images size={24} weight="thin" /><span>暂无作品</span></div>}
      {items.map((item) => (
        <div key={item.id} className={`strip ${item.id === currentId ? 'is-on' : ''}`}>
          <button type="button" onClick={() => onPick(item)} title={item.prompt.slice(0, 80)}>
            <img src={item.thumbnail} alt={item.prompt.slice(0, 80)} loading="lazy" />
          </button>
          <button
            type="button"
            className="kill icon-btn"
            aria-label="删除"
            title="删除历史图像"
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
