import { Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { ScenarioStats } from '../shared/run-report'

const C = { passed: '#19c3a0', failed: '#ff5d5d', cancelled: '#8c9bb9', time: '#7c6dff' }
const num = (n: number) => n.toLocaleString('fa-IR')
const secs = (ms?: number) => ms == null ? '—' : ms < 1000 ? '<۱ ثانیه' : num(Math.round(ms / 1000)) + ' ثانیه'
const tip = { background: 'var(--cv-card, #18212f)', border: '1px solid var(--cv-line, #2a3752)', borderRadius: 10, color: 'var(--cv-text, #e8eefb)', fontSize: 12, direction: 'rtl' as const }

// Charts live in their own module so the page can lazy-load recharts only when Monitor opens.
export default function MonitorCharts({ stats }: { stats: ScenarioStats }) {
  const rate = stats.total ? Math.round((stats.passed / stats.total) * 100) : 0
  const data = stats.days.map(d => ({ ...d, label: d.day.slice(5), sec: Math.round(d.avgMs / 100) / 10 }))
  const pie = [
    { name: 'موفق', value: stats.passed, color: C.passed },
    { name: 'ناموفق', value: stats.failed, color: C.failed },
    { name: 'لغو', value: stats.cancelled, color: C.cancelled },
  ].filter(p => p.value > 0)
  const kpis: [string, string, string][] = [
    ['کل اجراها', num(stats.total), 'var(--cv-text, #e8eefb)'],
    ['موفق', num(stats.passed), C.passed],
    ['ناموفق', num(stats.failed), C.failed],
    ['میانگین مدت', secs(stats.avgMs), C.time],
  ]
  return <div className="mc">
    <div className="mc-kpis">{kpis.map(([l, v, c]) => <div key={l} className="mc-kpi" style={{ borderColor: c }}><small>{l}</small><strong style={{ color: c }}>{v}</strong></div>)}</div>
    <div className="mc-grid">
      <div className="mc-main" dir="ltr">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
            <defs>
              <linearGradient id="gp" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.passed} stopOpacity={0.55} /><stop offset="100%" stopColor={C.passed} stopOpacity={0} /></linearGradient>
              <linearGradient id="gf" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={C.failed} stopOpacity={0.55} /><stop offset="100%" stopColor={C.failed} stopOpacity={0} /></linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 4" stroke="currentColor" opacity={0.12} vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis allowDecimals={false} tick={{ fontSize: 10, fill: 'currentColor' }} tickLine={false} axisLine={false} />
            <Tooltip contentStyle={tip} labelStyle={{ color: 'var(--cv-muted, #8c9bb9)' }} formatter={(v: number, n: string) => [num(v), n]} />
            <Area type="monotone" dataKey="passed" name="موفق" stroke={C.passed} strokeWidth={2.5} fill="url(#gp)" animationDuration={900} />
            <Area type="monotone" dataKey="failed" name="ناموفق" stroke={C.failed} strokeWidth={2.5} fill="url(#gf)" animationDuration={1100} />
            <Line type="monotone" dataKey="cancelled" name="لغو" stroke={C.cancelled} strokeWidth={1.5} strokeDasharray="4 4" dot={false} animationDuration={1300} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="mc-donut">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={pie} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="92%" paddingAngle={pie.length > 1 ? 3 : 0} stroke="none" animationDuration={1000} cornerRadius={6}>
              {pie.map(p => <Cell key={p.name} fill={p.color} />)}
            </Pie>
            <Tooltip contentStyle={tip} formatter={(v: number, n: string) => [num(v), n]} />
          </PieChart>
        </ResponsiveContainer>
        <div className="mc-rate"><strong>{num(rate)}٪</strong><small>نرخ موفقیت</small></div>
      </div>
    </div>
  </div>
}
