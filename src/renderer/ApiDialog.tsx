import { useEffect } from 'react'
import type { AppSettings } from '../shared/types'
import { ApiGuide } from './ApiGuide'
import { ApiTester } from './ApiTester'

interface Props { settings: AppSettings | null; scenario: { id?: string; title: string }; inputText: string; dirty: boolean; onClose: () => void; onOpenSettings: () => void }

// "API command for this scenario": ready-made curl / n8n setup plus a one-click test through the real API.
export function ApiDialog({ settings, scenario, inputText, dirty, onClose, onOpenSettings }: Props) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return <div className="modal-backdrop" onMouseDown={event => { if (event.target === event.currentTarget) onClose() }}>
    <section className="modal api-modal" role="dialog" aria-modal="true" aria-label="دستور API این سناریو">
      <header><div><span className="eyebrow">API</span><h2>دستور API «{scenario.title || 'بدون نام'}»</h2></div><button className="icon-button" aria-label="بستن" onClick={onClose}>×</button></header>
      {!scenario.id ? <p className="notice">این سناریو هنوز ذخیره نشده است. ابتدا «ذخیره سناریو» را بزنید تا شناسه بگیرد.</p>
        : !settings ? <p>در حال دریافت تنظیمات…</p>
        : !settings.apiEnabled ? <p className="notice">API غیرفعال است. <button className="text-button" onClick={onOpenSettings}>رفتن به تنظیمات اتصال</button></p>
        : <>
          {dirty && <p className="notice">تغییرات ذخیره‌نشده در سناریو به API اعمال نمی‌شود؛ ابتدا ذخیره کنید.</p>}
          <div className="id-row"><span>شناسهٔ سناریو</span><code dir="ltr">{scenario.id}</code><button className="text-button" onClick={() => void navigator.clipboard?.writeText(scenario.id!).catch(() => undefined)}>کپی</button></div>
          <ApiGuide port={settings.port} token={settings.token} scenarioId={scenario.id} />
          <ApiTester scenarios={[{ id: scenario.id, title: scenario.title }]} scenarioId={scenario.id} defaultInput={inputText} />
        </>}
    </section>
  </div>
}
