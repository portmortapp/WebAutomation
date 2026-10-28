import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | { kind?: 'item'; label: string; hint?: string; icon?: React.ReactNode; disabled?: boolean; danger?: boolean; onClick: () => void }
  | { kind: 'header'; label: string }
  | { kind: 'separator' }

// Right-click menu: opens at the pointer, stays inside the window, closes on Escape, outside click, scroll or resize.
export function ContextMenu({ x, y, items, onClose, label = 'منوی راست‌کلیک' }: { x: number; y: number; items: MenuItem[]; onClose: () => void; label?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    const margin = 8
    setPos({
      left: Math.max(margin, Math.min(x, window.innerWidth - width - margin)),
      top: Math.max(margin, Math.min(y, window.innerHeight - height - margin))
    })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }, [x, y, items.length])

  useEffect(() => {
    const close = () => onClose()
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const buttons = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
        buttons[(index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length]?.focus()
      }
    }
    const onDown = (event: MouseEvent) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('mousedown', onDown, true)
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', close)
    window.addEventListener('blur', close)
    const onScroll = (event: Event) => { if (!ref.current?.contains(event.target as Node)) onClose() }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('mousedown', onDown, true)
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', close)
      window.removeEventListener('blur', close)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [onClose])

  return <div className="context-menu" ref={ref} role="menu" aria-label={label} style={pos} onPointerDown={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation() }}>
    {items.map((item, index) => {
      if (item.kind === 'separator') return <hr key={index} />
      if (item.kind === 'header') return <h5 key={index}>{item.label}</h5>
      return <button key={index} role="menuitem" disabled={item.disabled} className={item.danger ? 'danger' : ''} onClick={() => { onClose(); item.onClick() }}>
        <span className="menu-icon">{item.icon}</span><span className="menu-label">{item.label}</span>{item.hint && <small>{item.hint}</small>}
      </button>
    })}
  </div>
}
