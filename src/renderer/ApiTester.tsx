import { useEffect, useRef, useState } from 'react'
import type { JsonValue, RunRecord } from '../shared/types'
import { isTerminalStatus } from '../shared/types'

interface Props { scenarios: { id: string; title: string }[]; scenarioId?: string; defaultInput?: string }
type Line = { tone: 'ok' | 'bad' | 'info'; text: string }

const statusText: Record<string, string> = { queued: 'در صف', running: 'در حال اجرا', cancelling: 'در حال لغو', passed: 'موفق', failed: 'ناموفق', timeout: 'مهلت تمام شد', cancelled: 'لغو شد' }

// Sends the same HTTP requests n8n would send (to this app's own API) and shows every step.
export function ApiTester({ scenarios, scenarioId, defaultInput = '{}' }: Props) {
  const [id, setId] = useState(scenarioId ?? scenarios[0]?.id ?? '')
  const [input, setInput] = useState(defaultInput)
  const [busy, setBusy] = useState(false)
  const [lines, setLines] = useState<Line[]>([])
  const [result, setResult] = useState<RunRecord | null>(null)
  const stop = useRef(false)
  useEffect(() => { if (scenarioId) setId(scenarioId) }, [scenarioId])
  useEffect(() => () => { stop.current = true }, [])

  const log = (tone: Line['tone'], text: string) => setLines(previous => [...previous, { tone, text }])
  const run = async () => {
    stop.current = false; setBusy(true); setLines([]); setResult(null)
    try {
      let body: JsonValue = {}
      try { body = { input: JSON.parse(input || '{}') as JsonValue } } catch { log('bad', 'ورودی JSON معتبر نیست.'); return }
      log('info', 'POST /api/scenarios/' + id + '/run')
      const started = await window.electronAPI.apiCall({ method: 'POST', path: '/api/scenarios/' + encodeURIComponent(id) + '/run', body })
      const run = (started.body as { run?: RunRecord } | null)?.run
      if (started.status !== 202 || !run) {
        const message = (started.body as { error?: { message?: string } } | null)?.error?.message
        log('bad', 'پاسخ ' + started.status + (message ? ' — ' + message : '')); return
      }
      log('ok', started.status + ' Run queued · ' + started.ms + ' ms · شناسه ' + run.id)
      let last = ''
      for (let attempt = 0; attempt < 400 && !stop.current; attempt++) {
        await new Promise(resolve => setTimeout(resolve, 1500))
        const polled = await window.electronAPI.apiCall({ method: 'GET', path: '/api/runs/' + encodeURIComponent(run.id) })
        const current = polled.body as unknown as RunRecord
        if (polled.status !== 200 || !current) { log('bad', 'GET /api/runs/' + run.id + ' ← ' + polled.status); return }
        if (current.status !== last) { last = current.status; log(isTerminalStatus(current.status) ? (current.status === 'passed' ? 'ok' : 'bad') : 'info', 'GET /api/runs/… ← ' + (statusText[current.status] ?? current.status)) }
        if (isTerminalStatus(current.status)) { setResult(current); return }
      }
      if (stop.current) log('info', 'پیگیری متوقف شد.')
    } catch (error) { log('bad', String((error as Error).message ?? error)) }
    finally { setBusy(false) }
  }
  return <div className="api-tester">
    <div className="api-tester-head"><h4>امتحان API (همان درخواستی که n8n می‌فرستد)</h4></div>
    <div className="form-grid">
      <label>سناریو<select aria-label="سناریوی تست API" value={id} disabled={busy} onChange={e => setId(e.target.value)}>{scenarios.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select></label>
      <label className="span-all">ورودی JSON (اختیاری)<textarea dir="ltr" aria-label="ورودی تست API" rows={3} spellCheck={false} disabled={busy} value={input} onChange={e => setInput(e.target.value)} /></label>
    </div>
    <div className="api-tester-actions"><button className="primary" disabled={busy || !id} onClick={run}>{busy ? 'در حال اجرا…' : '▶ ارسال درخواست آزمایشی'}</button>{busy && <button className="text-button" onClick={() => { stop.current = true }}>توقف پیگیری</button>}</div>
    {lines.length > 0 && <ol className="api-log" aria-live="polite">{lines.map((line, index) => <li key={index} className={line.tone} dir="ltr">{line.text}</li>)}</ol>}
    {result && <div className="code-block"><pre dir="ltr">{JSON.stringify({ status: result.status, output: result.output ?? null, failedStep: result.failedStep ?? null, error: result.error ?? null }, null, 2)}</pre></div>}
  </div>
}
