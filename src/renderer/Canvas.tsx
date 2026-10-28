import React, { useEffect, useRef, useState } from 'react'
import type { ScenarioStep, StepResult } from '../shared/types'
import { stepLabels } from '../shared/steps'
import { ContextMenu, type MenuItem } from './ContextMenu'

type StepType = ScenarioStep['type']
type Tone = 'flow' | 'action' | 'data'

const W = 236, H = 92, GX = 100, GY = 98, R = 18
// Columns that keep nodes readable (about 72% zoom or more) for the current canvas width.
const colsFor = (width: number) => Math.max(1, Math.min(6, Math.floor((width - 48 + GX * 0.72) / ((W + GX) * 0.72))))

const icons: Record<StepType | 'start' | 'end', React.ReactNode> = {
  start: <path d="M13 3 5 14h6l-1 7 8-11h-6z" />,
  end: <path d="M5 21V4m0 0h12l-2.5 4L17 12H5" />,
  navigate: <><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c3.2 3.2 3.2 14.8 0 18M12 3c-3.2 3.2-3.2 14.8 0 18" /></>,
  click: <path d="m6 3 12 7.5-5.2 1.6L11 18z" />,
  fill: <><rect x="3" y="7" width="18" height="10" rx="2.5" /><path d="M7 12h5" /></>,
  select: <><rect x="3" y="5" width="18" height="14" rx="2.5" /><path d="m9 11 3 3 3-3" /></>,
  check: <><rect x="4" y="4" width="16" height="16" rx="3.5" /><path d="m8.5 12.2 2.4 2.4 4.6-5.2" /></>,
  press: <><rect x="2.5" y="6" width="19" height="12" rx="2.5" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>,
  hover: <><path d="m8 6 9 5.5-4 1.2-1.4 4z" /><circle cx="8" cy="6" r="4.5" strokeDasharray="2 2.4" /></>,
  scroll: <path d="M12 4v16M8 8l4-4 4 4M8 16l4 4 4-4" />,
  wait: <path d="M7 3.5h10M7 20.5h10M8 3.5c0 5.5 8 5.5 8 8.5s-8 3-8 8.5" />,
  pause: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.2 2" /></>,
  field: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="3.2" /></>,
  table: <><rect x="3" y="4" width="18" height="16" rx="2.5" /><path d="M3 10h18M3 15h18M9.5 4v16" /></>,
  form: <><rect x="4" y="3.5" width="16" height="17" rx="2.5" /><path d="M8 8h8M8 12h8M8 16h4" /></>,
  waitPage: <><path d="M12 3v4M12 17v4M3 12h4M17 12h4" /><circle cx="12" cy="12" r="3" /></>,
  history: <path d="M4 12a8 8 0 1 0 2.6-5.9M4 4v4.5h4.5" />,
  tab: <><path d="M3 9h18v11H3z" /><path d="M3 9V6.5A1.5 1.5 0 0 1 4.5 5H10l2 4" /></>,
  dialog: <><path d="M4 5h16v11H9l-5 4z" /><path d="M9 10h6" /></>,
  code: <path d="m8 7-5 5 5 5M16 7l5 5-5 5M13.5 5l-3 14" />,
  screenshot: <><path d="M4 8h3l1.6-2.5h6.8L17 8h3v11H4z" /><circle cx="12" cy="13.5" r="3.4" /></>
}

export const toneOf: Record<StepType, Tone> = {
  navigate: 'flow', wait: 'flow', pause: 'flow', scroll: 'flow', waitPage: 'flow', history: 'flow', tab: 'flow', dialog: 'flow', code: 'data', form: 'action',
  click: 'action', fill: 'action', select: 'action', check: 'action', press: 'action', hover: 'action',
  field: 'data', table: 'data', screenshot: 'data'
}

const groups: { title: string; hint: string; tone: Tone; types: StepType[] }[] = [
  { title: 'جریان صفحه', hint: 'رفتن، انتظار و حرکت', tone: 'flow', types: ['navigate', 'wait', 'waitPage', 'pause', 'scroll', 'history', 'tab', 'dialog'] },
  { title: 'تعامل با صفحه', hint: 'کلیک، نوشتن و انتخاب', tone: 'action', types: ['click', 'fill', 'form', 'select', 'check', 'press', 'hover'] },
  { title: 'استخراج داده', hint: 'خواندن مقدار، جدول و تصویر', tone: 'data', types: ['field', 'table', 'screenshot', 'code'] }
]

export function NodeIcon({ type }: { type: StepType | 'start' | 'end' }) {
  return <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{icons[type]}</svg>
}

const position = (index: number, cols: number) => ({ x: (index % cols) * (W + GX), y: Math.floor(index / cols) * (H + GY) })

function detail(step: ScenarioStep): string {
  switch (step.type) {
    case 'navigate': return step.url.kind === 'literal' ? step.url.value.replace(/^https?:\/\//, '') : step.url.kind === 'secret' ? 'رمز: ' + step.url.value : 'input.' + step.url.value
    case 'fill': return step.selector || 'عنصر انتخاب نشده'
    case 'select': return step.selector || 'عنصر انتخاب نشده'
    case 'press': return step.key + (step.selector ? ' ← ' + step.selector : '')
    case 'check': return (step.checked ? 'تیک ✓ ' : 'بدون تیک ') + step.selector
    case 'scroll': return step.to === 'element' ? step.selector : step.to === 'top' ? 'بالای صفحه' : 'پایین صفحه'
    case 'pause': return step.seconds + ' ثانیه'
    case 'screenshot': return 'shot-' + step.name + '.png'
    case 'form': return step.fields.length + ' فیلد · ' + step.fields.map(f => f.selector).slice(0, 2).join('، ')
    case 'waitPage': return step.mode === 'url' ? 'آدرس: ' + step.url : step.mode === 'networkidle' ? 'پایان درخواست‌های شبکه' : step.mode === 'domcontentloaded' ? 'پایان بارگذاری HTML' : 'پایان بارگذاری صفحه'
    case 'history': return step.action === 'reload' ? 'بارگذاری مجدد' : step.action === 'back' ? 'صفحهٔ قبل' : 'صفحهٔ بعد'
    case 'tab': return (step.action === 'close' ? 'بستن تب فعلی' : 'رفتن به تب ' + (step.index + 1))
    case 'dialog': return step.action === 'accept' ? 'تأیید پیام' : 'رد کردن پیام'
    case 'code': return step.code.split('\n').find(line => line.trim() && !line.trim().startsWith('//'))?.trim().slice(0, 60) ?? 'کد سفارشی'
    case 'click': return (step.opensTab ? 'تب جدید ← ' : '') + (step.double ? 'دوبار · ' : step.button && step.button !== 'left' ? step.button + ' · ' : '') + (step.selector || 'عنصر انتخاب نشده')
    case 'field': return 'output.' + step.name
    case 'table': return 'output.' + step.name + '[] · ' + step.columns.length + ' ستون'
    default: return step.selector || 'عنصر انتخاب نشده'
  }
}

// Orthogonal connector with rounded corners; wraps to the next row when the line is full.
function route(from: { x: number; y: number }, to: { x: number; y: number }): { d: string; mid: { x: number; y: number } } {
  if (from.x === to.x) {
    // Single column: straight line from the bottom of one node to the top of the next.
    const cx = from.x + W / 2, ya = from.y + H, yb = to.y
    return { d: `M${cx} ${ya} V${yb}`, mid: { x: cx, y: (ya + yb) / 2 } }
  }
  const x1 = from.x + W, y1 = from.y + H / 2, x2 = to.x, y2 = to.y + H / 2
  if (Math.abs(y1 - y2) < 1) {
    const cx = (x1 + x2) / 2
    return { d: `M${x1} ${y1} C${cx} ${y1} ${cx} ${y2} ${x2} ${y2}`, mid: { x: cx, y: y1 } }
  }
  const ym = from.y + H + GY / 2
  const xa = x1 + 44, xb = x2 - 44
  const d = `M${x1} ${y1} H${xa - R} Q${xa} ${y1} ${xa} ${y1 + R} V${ym - R} Q${xa} ${ym} ${xa - R} ${ym} H${xb + R} Q${xb} ${ym} ${xb} ${ym + R} V${y2 - R} Q${xb} ${y2} ${xb + R} ${y2} H${x2}`
  return { d, mid: { x: (xa + xb) / 2, y: ym } }
}

type Props = {
  steps: ScenarioStep[]
  selectedId: string
  results: StepResult[]
  locked: boolean
  running: boolean
  outputNames: string[]
  canTest: boolean
  onSelect: (id: string) => void
  onInsert: (index: number, type: StepType) => void
  onDelete: (id: string) => void
  onDuplicate: (index: number) => void
  onDrop: (fromId: string, toId: string) => void
  onTest: (id: string, fresh?: boolean) => void
  suggestAfter?: { id: string; tick: number } | null
  onStart: () => void
  onMove: (id: string, offset: number) => void
  onFocusInput: () => void
}

export function Canvas({ steps, selectedId, results, locked, running, outputNames, canTest, onSelect, onInsert, onDelete, onDuplicate, onDrop, onTest, suggestAfter, onStart, onMove, onFocusInput }: Props) {
  const host = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ x: 40, y: 60, k: 1 })
  const [picker, setPicker] = useState<{ index: number; x: number; y: number } | null>(null)
  const [query, setQuery] = useState('')
  const [dragId, setDragId] = useState('')
  const [overId, setOverId] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; stepId?: string } | null>(null)
  const [cols, setCols] = useState(4)
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  const total = steps.length + 2
  const used = Math.min(total, cols)
  const bounds = { w: used * W + (used - 1) * GX, h: Math.ceil(total / cols) * H + (Math.ceil(total / cols) - 1) * GY }

  const fit = () => {
    const el = host.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    // Prefer readable nodes: never shrink below 58%, pan for the rest.
    const k = Math.max(0.58, Math.min(1.1, (width - 90) / bounds.w, (height - 130) / bounds.h))
    setView({ k, x: Math.max(24, (width - bounds.w * k) / 2), y: Math.max(64, (height - bounds.h * k) / 2) })
  }
  useEffect(fit, [total, cols])
  useEffect(() => {
    const el = host.current
    if (!el) return
    const measure = () => { if (el.clientWidth) { const next = colsFor(el.clientWidth); setCols(next); fit() } }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => observer.disconnect()
  }, [total])

  const zoomAt = (factor: number, cx?: number, cy?: number) => setView(v => {
    const rect = host.current?.getBoundingClientRect()
    const px = cx ?? (rect ? rect.width / 2 : 0), py = cy ?? (rect ? rect.height / 2 : 0)
    const k = Math.max(0.3, Math.min(1.8, v.k * factor))
    return { k, x: px - (px - v.x) * (k / v.k), y: py - (py - v.y) * (k / v.k) }
  })
  useEffect(() => {
    const el = host.current
    if (!el) return
    const onWheel = (event: WheelEvent) => {
      if ((event.target as HTMLElement).closest('.node-picker')) return
      event.preventDefault()
      const rect = el.getBoundingClientRect()
      if (event.ctrlKey || event.metaKey) zoomAt(event.deltaY < 0 ? 1.1 : 0.9, event.clientX - rect.left, event.clientY - rect.top)
      else setView(v => ({ ...v, x: v.x - event.deltaX, y: v.y - event.deltaY }))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const resultOf = (id: string) => results.find(item => item.id === id)
  const items: { key: string; kind: 'start' | 'end' | 'step'; step?: ScenarioStep; index: number }[] = [
    { key: 'start', kind: 'start', index: 0 },
    ...steps.map((step, i) => ({ key: step.id, kind: 'step' as const, step, index: i + 1 })),
    { key: 'end', kind: 'end', index: steps.length + 1 }
  ]

  const openPicker = (index: number, event: React.MouseEvent) => {
    const rect = host.current!.getBoundingClientRect()
    setQuery('')
    setPicker({ index, x: Math.min(Math.max(event.clientX - rect.left, 160), rect.width - 160), y: Math.max(10, Math.min(event.clientY - rect.top + 14, rect.height - 390)) })
  }
  const nodeMenu = (id: string): MenuItem[] => {
    const index = steps.findIndex(step => step.id === id)
    const step = steps[index]
    if (!step) return []
    return [
      { kind: 'header', label: step.title },
      { label: 'ویرایش نود', icon: '✎', onClick: () => onSelect(id) },
      { label: 'اجرا تا این نود', icon: '▶', disabled: !canTest || locked, hint: canTest ? '' : 'مرورگر آزمایشی بسته است', onClick: () => onTest(id) },
      { label: 'اجرای دوباره از نود ۱', icon: '↻', disabled: !canTest || locked, onClick: () => onTest(id, true) },
      { kind: 'separator' },
      { label: 'افزودن نود قبل از این', icon: '⤒', disabled: locked || steps.length >= 100, onClick: () => at(index) },
      { label: 'افزودن نود بعد از این', icon: '⤓', disabled: locked || steps.length >= 100, onClick: () => at(index + 1) },
      { label: 'کپی نود', icon: '⧉', disabled: locked || steps.length >= 100, onClick: () => onDuplicate(index) },
      { kind: 'separator' },
      { label: 'جابه‌جایی به عقب', icon: '←', disabled: locked || index === 0, onClick: () => onMove(id, -1) },
      { label: 'جابه‌جایی به جلو', icon: '→', disabled: locked || index === steps.length - 1, onClick: () => onMove(id, 1) },
      { kind: 'separator' },
      { label: 'حذف نود', icon: '🗑', danger: true, disabled: locked, onClick: () => onDelete(id) }
    ]
  }
  const canvasMenu = (): MenuItem[] => [
    { kind: 'header', label: 'افزودن نود به انتهای جریان' },
    ...groups.flatMap(group => group.types.map((type): MenuItem => ({ label: stepLabels[type], icon: <NodeIcon type={type} />, disabled: locked || steps.length >= 100, onClick: () => onInsert(steps.length, type) }))),
    { kind: 'separator' },
    { label: 'نمایش همه نودها', icon: '⤢', onClick: fit },
    { label: 'ورودی اجرا (input)', icon: '⌥', onClick: onFocusInput }
  ]
  // Opens the node picker for a position chosen from the menu (centered on the menu's own anchor).
  const at = (index: number) => {
    const rect = host.current!.getBoundingClientRect()
    setQuery('')
    setPicker({ index, x: Math.min(Math.max((menu?.x ?? rect.left + rect.width / 2) - rect.left, 160), rect.width - 160), y: Math.max(10, Math.min((menu?.y ?? rect.top + 60) - rect.top, rect.height - 390)) })
  }
  // After a test run reaches a node, offer the node picker right after it.
  useEffect(() => {
    if (!suggestAfter) return
    const index = steps.findIndex(step => step.id === suggestAfter.id)
    const rect = host.current?.getBoundingClientRect()
    if (index < 0 || !rect) return
    setQuery('')
    setPicker({ index: index + 1, x: Math.max(160, Math.min(rect.width / 2, rect.width - 160)), y: Math.max(10, Math.min(rect.height - 400, rect.height / 2 - 120)) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggestAfter?.tick])
  const filtered = groups.map(group => ({ ...group, types: group.types.filter(type => !query.trim() || stepLabels[type].includes(query.trim()) || type.includes(query.trim().toLowerCase())) })).filter(group => group.types.length)

  return <section className="canvas-wrap" aria-label="بوم سناریو" ref={host}
    onPointerDown={event => { if ((event.target as HTMLElement).closest('.flow-node,.node-picker,.canvas-controls,.add-between,.canvas-top')) return; setPicker(null); pan.current = { x: event.clientX, y: event.clientY, vx: view.x, vy: view.y }; (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId) }}
    onPointerMove={event => { const p = pan.current; if (p) setView(v => ({ ...v, x: p.vx + event.clientX - p.x, y: p.vy + event.clientY - p.y })) }}
    onPointerUp={() => { pan.current = null }}
    onContextMenu={event => { event.preventDefault(); setPicker(null); const node = (event.target as HTMLElement).closest<HTMLElement>('[data-step-id]'); setMenu({ x: event.clientX, y: event.clientY, stepId: node?.dataset.stepId }) }}>
    <div className="canvas-top">
      <div className="canvas-title"><span className="live-dot" />جریان کاری<small>{steps.length} نود</small></div>
      <button className="canvas-add" disabled={locked || steps.length >= 100} onClick={event => openPicker(steps.length, event)}><span>＋</span> افزودن نود</button>
    </div>
    <div className="canvas-layer" style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})` }} dir="ltr">
      <svg className="canvas-edges" width={bounds.w + 400} height={bounds.h + 400} style={{ overflow: 'visible' }}>
        <defs>
          <linearGradient id="edge-grad" x1="0" x2="1"><stop offset="0" stopColor="#6d7cff" /><stop offset="1" stopColor="#ff6d5a" /></linearGradient>
          <marker id="arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1 1 9 5 1 9z" fill="#7d8aa5" /></marker>
        </defs>
        {items.slice(0, -1).map((item, i) => {
          const next = items[i + 1]
          const r = route(position(item.index, cols), position(next.index, cols))
          const from = item.step ? resultOf(item.step.id) : undefined
          const to = next.step ? resultOf(next.step.id) : undefined
          const state = to?.status === 'running' ? 'flowing' : (item.kind === 'start' || from?.status === 'passed') && to?.status === 'passed' ? 'done' : ''
          return <path key={item.key + next.key} d={r.d} className={'edge ' + state} markerEnd="url(#arrow)" />
        })}
      </svg>
      {items.slice(0, -1).map((item, i) => {
        const next = items[i + 1]
        const r = route(position(item.index, cols), position(next.index, cols))
        return <button key={'add' + item.key} className="add-between" style={{ left: r.mid.x, top: r.mid.y }} disabled={locked || steps.length >= 100} aria-label={'افزودن نود در جایگاه ' + (i + 1)} onClick={event => openPicker(i, event)}>＋</button>
      })}
      {items.map(item => {
        const pos = position(item.index, cols)
        if (item.kind !== 'step') {
          const isStart = item.kind === 'start'
          return <div key={item.key} className={'flow-node terminal ' + item.kind} style={{ left: pos.x, top: pos.y, width: W, height: H }} role="button" tabIndex={0} onClick={isStart ? onStart : undefined} onKeyDown={event => { if (isStart && event.key === 'Enter') onStart() }}>
            <span className="node-icon"><NodeIcon type={isStart ? 'start' : 'end'} /></span>
            <span className="node-text" dir="auto"><strong>{isStart ? 'شروع' : 'خروجی'}</strong><small dir="auto">{isStart ? 'ورودی n8n / API ← input' : outputNames.length ? outputNames.map(name => 'output.' + name).join('، ') : 'هنوز داده‌ای تعریف نشده'}</small></span>
            <i className={'port ' + (isStart ? 'out' : 'in')} />
          </div>
        }
        const step = item.step!
        const result = resultOf(step.id)
        const tone = toneOf[step.type]
        return <div key={step.id} data-step-id={step.id} className={['flow-node', tone, selectedId === step.id ? 'selected' : '', result?.status ?? '', dragId === step.id ? 'dragging' : '', overId === step.id && dragId !== step.id ? 'drop' : '', running && !result ? 'idle' : ''].join(' ')} style={{ left: pos.x, top: pos.y, width: W, height: H }}
          draggable={!locked} onDragStart={event => { setDragId(step.id); event.dataTransfer.effectAllowed = 'move' }} onDragOver={event => { if (dragId) { event.preventDefault(); setOverId(step.id) } }} onDrop={event => { event.preventDefault(); const from = dragId; setDragId(''); setOverId(''); if (from) onDrop(from, step.id) }} onDragEnd={() => { setDragId(''); setOverId('') }}
          role="button" tabIndex={0} aria-label={step.title} aria-pressed={selectedId === step.id} onClick={() => onSelect(step.id)} onKeyDown={event => { if (event.key === 'Enter') onSelect(step.id); if ((event.key === 'Delete' || event.key === 'Backspace') && !locked) onDelete(step.id) }}>
          <i className="port in" /><i className="port out" />
          <span className="node-num">{item.index}</span>
          <span className="node-icon"><NodeIcon type={step.type} /></span>
          <span className="node-text" dir="auto"><strong>{step.title}</strong><small><b>{stepLabels[step.type]}</b>{' · '}<span dir="auto">{detail(step)}</span></small></span>
          <span className="node-status" aria-hidden="true">{result?.status === 'passed' ? '✓' : result?.status === 'failed' ? '!' : result?.status === 'running' ? <i className="spin" /> : ''}</span>
          {(step.retries || step.continueOnError || (result?.attempts ?? 0) > 1) ? <span className="node-badges">{step.retries ? <em title="تلاش مجدد">↻ {step.retries}</em> : null}{step.continueOnError ? <em title="ادامه پس از خطا">⤼</em> : null}{(result?.attempts ?? 0) > 1 ? <em className="warn">تلاش {result!.attempts}</em> : null}</span> : null}
          <span className="node-actions" onClick={event => event.stopPropagation()}>
            <button aria-label="اجرا تا این نود" title="اجرا تا این نود (ادامه از تست قبلی)" disabled={!canTest || locked} onClick={() => onTest(step.id)}>▶</button>
            <button aria-label="کپی نود" title="کپی" disabled={locked || steps.length >= 100} onClick={() => onDuplicate(item.index - 1)}>⧉</button>
            <button aria-label="حذف نود" title="حذف" disabled={locked} onClick={() => onDelete(step.id)}>🗑</button>
          </span>
        </div>
      })}
    </div>
    <div className="canvas-controls" role="toolbar" aria-label="کنترل بوم">
      <button aria-label="بزرگ‌نمایی" onClick={() => zoomAt(1.2)}>＋</button>
      <button aria-label="کوچک‌نمایی" onClick={() => zoomAt(1 / 1.2)}>－</button>
      <button aria-label="نمایش همه نودها" title="نمایش همه" onClick={fit}>⤢</button>
      <span>{Math.round(view.k * 100)}٪</span>
    </div>
    {steps.length === 0 && <div className="canvas-empty"><strong>اولین نود را اضافه کنید</strong><p>روی ＋ بزنید یا در «کد پیشرفته» ضبط کنید تا نودها خودکار ساخته شوند.</p></div>}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.stepId ? nodeMenu(menu.stepId) : canvasMenu()} onClose={() => setMenu(null)} />}
    {picker && <div className="node-picker" style={{ left: picker.x, top: picker.y }} role="dialog" aria-label="انتخاب نود" onPointerDown={event => event.stopPropagation()}>
      <input autoFocus placeholder="جستجوی نود…" aria-label="جستجوی نود" value={query} onChange={event => setQuery(event.target.value)} onKeyDown={event => { if (event.key === 'Escape') setPicker(null) }} />
      <div className="picker-scroll">{filtered.map(group => <div key={group.title} className={'picker-group ' + group.tone}><h4>{group.title}<small>{group.hint}</small></h4>{group.types.map(type => <button key={type} onClick={() => { onInsert(picker.index, type); setPicker(null) }}><span className="node-icon"><NodeIcon type={type} /></span>{stepLabels[type]}</button>)}</div>)}{!filtered.length && <p className="muted">نودی پیدا نشد.</p>}</div>
      <button className="picker-close" onClick={() => setPicker(null)}>بستن</button>
    </div>}
  </section>
}
