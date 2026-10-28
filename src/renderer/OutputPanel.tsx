import React, { useEffect, useState } from 'react'
import type { JsonValue, RunRecord, RunSummary, StepPreview } from '../shared/types'

const statusText: Record<string, string> = { queued: 'در صف', running: 'در حال اجرا', cancelling: 'در حال لغو', passed: 'موفق', failed: 'ناموفق', timeout: 'زمان تمام شد', cancelled: 'لغو شد' }

function Shots({ run }: { run: RunRecord | null }) {
  const [images, setImages] = useState<{ name: string; src: string }[]>([])
  const [loading, setLoading] = useState(false)
  const key = run ? run.id + ':' + (run.artifacts ?? []).join(',') : ''
  useEffect(() => {
    let live = true
    setImages([])
    if (!run?.artifacts?.length) return
    setLoading(true)
    void Promise.all(run.artifacts.map(async name => ({ name, src: await window.electronAPI.getArtifact(run.id, name) }))).then(items => {
      if (live) setImages(items.filter((item): item is { name: string; src: string } => !!item.src))
    }).catch(() => undefined).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [key])
  if (!run?.artifacts?.length) return <div className="output-empty"><span>▣</span><div><strong>تصویری برای این اجرا ثبت نشده است.</strong><p>با خطا، تصویر صفحه به‌صورت خودکار ذخیره می‌شود؛ مرحله «اسکرین‌شات» هم تصویر مشخصی می‌گیرد.</p></div></div>
  return <div className="shots">{loading && <p className="muted">در حال بارگذاری تصاویر…</p>}{images.map(image => <figure key={image.name}><img src={image.src} alt={image.name} /><figcaption dir="ltr">{image.name === 'failure.png' ? 'failure.png — صفحه هنگام خطا' : image.name}</figcaption></figure>)}</div>
}

export function OutputPanel({ run, preview, previewError, expanded, onExpand, history, onOpenRun }: { run: RunRecord | null; preview: StepPreview | null; previewError: string; expanded: boolean; onExpand: () => void; history: RunSummary[]; onOpenRun: (id: string) => void }) {
  const [tab, setTab] = useState<'data' | 'json' | 'logs' | 'shots' | 'history'>('data')
  const output = preview ? preview.output : run?.output
  const object = output && typeof output === 'object' && !Array.isArray(output) ? output : null
  const entries = object ? Object.entries(object) : []
  const tables = entries.filter(([, value]) => Array.isArray(value))
  const fields = entries.filter(([, value]) => !Array.isArray(value))
  const [copied, setCopied] = useState(false)
  const display = (value: JsonValue) => value === null ? 'null' : typeof value === 'object' ? JSON.stringify(value) : String(value)
  const status = previewError ? 'خطای تست مرحله' : preview ? 'پیش‌نمایش مرحله' : run ? 'وضعیت: ' + run.status : 'هنوز داده‌ای استخراج نشده'
  return <section className="output-panel" aria-label="نتیجه استخراج">
    <div className="output-toolbar"><div className="output-heading"><span className={'status-dot ' + (previewError || run?.error ? 'bad' : '')} /><h3>خروجی</h3><span className="muted">{status}</span>{run && !preview && <span className="muted">{run.durationMs !== undefined ? (run.durationMs / 1000).toFixed(2) + ' ثانیه' : ''}</span>}</div><div className="segmented" role="tablist" aria-label="نمای خروجی">{([['data', 'داده‌ها'], ['json', 'JSON'], ['logs', 'لاگ اجرا'], ['shots', 'تصاویر' + (run?.artifacts?.length ? ' (' + run.artifacts.length + ')' : '')], ['history', 'تاریخچه']] as const).map(([value, label]) => <button role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} key={value} onClick={() => setTab(value)}>{label}</button>)}</div><button className="text-button" disabled={output === undefined || output === null} onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify(output, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { setCopied(false) } }}>{copied ? 'کپی شد' : 'کپی JSON'}</button></div>
    <button className="expand-output" onClick={onExpand}>{expanded ? '↙ بازگشت به طراحی' : '↗ گسترش خروجی'}</button>
    <div className="output-body">
      {(previewError || (!preview && run?.error)) && <div className="error-box" role="alert">{previewError || (run?.error?.code + ': ' + run?.error?.message)}</div>}
      {preview && !previewError && <p className="preview-note">تست روی صفحه فعلی انجام شد. پیش‌نمایش جدول حداکثر ۲۰ ردیف است؛ اجرای کامل تمام ردیف‌ها را برمی‌گرداند.</p>}
      {run?.failedStep && !preview && <div className="error-box" role="note">مرحله ناموفق: {run.failedStep.index + 1}. {run.failedStep.title}</div>}
      {tab === 'history' ? <div className="history-list">{history.length === 0 ? <p className="muted">هنوز اجرایی برای این سناریو ثبت نشده است.</p> : history.map(item => <button key={item.id} className={'history-item ' + item.status + (run?.id === item.id ? ' selected' : '')} onClick={() => onOpenRun(item.id)}><span className="history-dot" /><span><strong>{statusText[item.status] ?? item.status}</strong><small dir="ltr">{new Date(item.createdAt).toLocaleString('fa-IR')}</small></span><span className="history-meta">{item.durationMs !== undefined ? (item.durationMs / 1000).toFixed(1) + ' ث' : ''}{item.failedStep ? ' · مرحله ' + (item.failedStep.index + 1) : ''}{item.artifacts?.length ? ' · ▣' : ''}</span></button>)}</div> : tab === 'shots' ? <Shots run={run} /> : tab === 'logs' ? <><pre className="logs">{run?.stdout || 'هنوز لاگی ثبت نشده است.'}</pre>{run?.stderr && <pre className="logs error-text">{run.stderr}</pre>}</> : tab === 'json' ? <pre className="json-output" data-testid="json-output">{output !== undefined && output !== null ? JSON.stringify(output, null, 2) : run?.status === 'passed' ? 'null' : '// خروجی پس از استخراج اینجا نمایش داده می‌شود'}</pre> : <>
        {fields.length > 0 && <div className="field-results">{fields.map(([key, value]) => <div className="field-result" key={key}><code>output.{key}</code><strong dir="auto">{display(value)}</strong><span>{value === null ? 'null' : typeof value === 'number' ? 'عدد' : typeof value === 'boolean' ? 'بله / خیر' : 'متن'}</span></div>)}</div>}
        {tables.map(([key, value]) => {
          const rows = value as JsonValue[]
          const names = [...new Set(rows.slice(0, 100).flatMap(row => row && typeof row === 'object' && !Array.isArray(row) ? Object.keys(row) : ['value']))]
          const total = preview?.results.find(r => r.rowCount !== undefined)?.rowCount ?? rows.length
          return <div className="result-table" key={key}><div className="table-caption"><code>output.{key}</code><span>{total} ردیف{rows.length > 100 ? ' · نمایش ۱۰۰ ردیف اول' : ''}</span></div>{!rows.length ? <p className="empty-table">جدول خالی است؛ هیچ ردیفی استخراج نشد.</p> : <table><thead><tr><th>#</th>{names.map(name => <th key={name}>{name}</th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, index) => <tr key={index}><td className="row-index">{index + 1}</td>{names.map(name => <td dir="auto" key={name}>{display(row && typeof row === 'object' && !Array.isArray(row) ? row[name] ?? null : row)}</td>)}</tr>)}</tbody></table>}</div>
        })}
        {!object && output !== null && output !== undefined && <pre className="json-output">{JSON.stringify(output, null, 2)}</pre>}
        {!tables.length && !fields.length && (output === null || output === undefined || object) && <div className="output-empty"><span>▤</span><div><strong>{run?.status === 'passed' || preview ? 'این مرحله داده‌ای به خروجی اضافه نکرد.' : 'داده‌هایت را قبل از اتصال به n8n ببین.'}</strong><p>یک مرحله «خواندن مقدار» یا «استخراج جدول» را تنظیم و آزمایش کن.</p></div></div>}
      </>}
    </div>
  </section>
}
