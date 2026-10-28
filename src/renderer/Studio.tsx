import React, { useEffect, useRef, useState } from 'react'
import { isTerminalStatus, type AppSettings, type JsonValue, type PickRequest, type ProfileInfo, type RunRecord, type RunSummary, type SaveScenarioInput, type SecretInfo, type Scenario, type ScenarioStep, type StepPreview, type StepResult } from '../shared/types'
import { createStep, stepLabels } from '../shared/steps'
import { StepEditor } from './StepEditor'
import { OutputPanel } from './OutputPanel'
import { Canvas } from './Canvas'
import { SettingsPage } from './SettingsPage'
import { ApiDialog } from './ApiDialog'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { normalizeUrl } from '../shared/url'
import { codeToSteps, stepsToCode } from '../shared/convert'
import { templates } from './templates'
import './studio.css'
import './theme.css'

const starterCode = "await page.setContent('<title>Automation ready</title>');\nreturn { title: await page.title(), input };"
const fresh = (): SaveScenarioInput => ({ title: 'سناریوی جدید', code: starterCode, headless: true, mode: 'steps', steps: [createStep('navigate')] })
const labelForStatus = (status?: string) => status === 'passed' ? 'انجام شد' : status === 'failed' ? 'خطا' : status === 'running' ? 'در حال اجرا' : ''

export default function Studio() {
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [draft, setDraft] = useState<SaveScenarioInput>(fresh)
  const [selectedId, setSelectedId] = useState<string>('')
  const [dirty, setDirty] = useState(false)
  const [section, setSection] = useState<'studio' | 'settings'>('studio')
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [savedSettings, setSavedSettings] = useState<AppSettings | null>(null)
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [apiDialog, setApiDialog] = useState(false)
  const [message, setMessage] = useState('')
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')
  const [showInput, setShowInput] = useState(false)
  const [inputText, setInputText] = useState('{}')
  const [timeoutText, setTimeoutText] = useState('')
  const [run, setRun] = useState<RunRecord | null>(null)
  const [preview, setPreview] = useState<StepPreview | null>(null)
  const [previewError, setPreviewError] = useState('')
  const [suggest, setSuggest] = useState<{ id: string; tick: number } | null>(null)
  const [previewUrl, setPreviewUrl] = useState('https://example.com')
  const [inspectorOpen, setInspectorOpen] = useState(false)
  const [editorOpen, setEditorOpen] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [codeUrl, setCodeUrl] = useState('')
  const [codeMenu, setCodeMenu] = useState<{ x: number; y: number } | null>(null)
  const codeArea = useRef<HTMLTextAreaElement>(null)
  const caret = useRef({ start: 0, end: 0 })
  const [report, setReport] = useState<{ count: number; skipped: string[]; exact: boolean; custom?: number; source: 'record' | 'code' } | null>(null)
  // Remembers which steps/code pair was last generated from each other, so syncing never clobbers manual edits.
  const synced = useRef({ steps: '', code: '' })
  const [focusOutput, setFocusOutput] = useState(false)
  const [profiles, setProfiles] = useState<ProfileInfo[]>([])
  const [secrets, setSecrets] = useState<SecretInfo[]>([])
  const [history, setHistory] = useState<RunSummary[]>([])
  const [profileName, setProfileName] = useState<string | null>(null)
  const [secretName, setSecretName] = useState('')
  const [secretValue, setSecretValue] = useState('')
  const activeRun = !!run && !isTerminalStatus(run.status)
  const locked = !!action || activeRun
  const steps = draft.steps ?? []
  const selected = steps.find(step => step.id === selectedId) ?? steps[0]
  const runId = activeRun ? run!.id : null

  useEffect(() => {
    document.querySelector('.step-item.selected')?.scrollIntoView({ block: 'nearest' })
  }, [selected?.id])

  useEffect(() => {
    let live = true
    void Promise.all([window.electronAPI.getScenarios(), window.electronAPI.getSettings(), window.electronAPI.listProfiles(), window.electronAPI.listSecrets()]).then(([items, config, profileItems, secretItems]) => {
      if (!live) return
      setScenarios(items); setSettings(config); setSavedSettings(config); setProfiles(profileItems); setSecrets(secretItems)
      if (items[0]) { setDraft({ ...items[0], mode: items[0].mode ?? 'code' }); setSelectedId(items[0].steps?.[0]?.id ?? '') }
    }).catch(error => { if (live) setMessage('خطا در بارگذاری: ' + String(error)) })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (!runId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try {
        const record = await window.electronAPI.getRun(runId)
        if (disposed) return
        if (!record) { setMessage('رکورد اجرا پیدا نشد.'); setRun(null); return }
        setRun(record)
        if (isTerminalStatus(record.status)) return
      } catch (error) { if (!disposed) setMessage('خطا در دریافت وضعیت: ' + String(error)) }
      if (!disposed) timer = setTimeout(poll, 400)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer) }
  }, [runId])

  // Messages disappear on their own so the workspace stays clean.
  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(''), 8000)
    return () => clearTimeout(timer)
  }, [message])

  const refreshHistory = async (scenarioId = draft.id) => {
    if (!scenarioId) { setHistory([]); return }
    try { setHistory(await window.electronAPI.listRuns(scenarioId, 30)) } catch { /* history is optional */ }
  }
  useEffect(() => { void refreshHistory(draft.id) }, [draft.id, run?.status])
  const openRun = async (id: string) => {
    try { const record = await window.electronAPI.getRun(id); if (record && !activeRun) setRun(record); setFocusOutput(false) }
    catch (error) { setMessage(String(error)) }
  }

  const change = (patch: Partial<SaveScenarioInput>) => {
    setDraft(previous => ({ ...previous, ...patch })); setDirty(true)
    setPreview(null); setPreviewError(''); setFocusOutput(false)
    if (!activeRun) setRun(null)
  }
  const changeStep = (value: ScenarioStep) => change({ steps: steps.map(step => step.id === value.id ? value : step) })
  const allowSwitch = () => !locked && (!dirty || confirm('تغییرات ذخیره نشده‌اند. از این سناریو خارج می‌شوید؟'))
  const load = (scenario?: Scenario) => {
    if (!allowSwitch()) return
    const value = scenario ? { ...scenario, mode: scenario.mode ?? 'code' as const } : fresh()
    setDraft(value); setDirty(false); setSelectedId(value.steps?.[0]?.id ?? ''); setEditorOpen(false); setReport(null); setSidebarOpen(false)
    synced.current = value.mode === 'code' && value.steps?.length ? { steps: JSON.stringify(value.steps), code: value.code } : { steps: '', code: '' }
    setRun(null); setPreview(null); setPreviewError(''); setMessage(''); setSection('studio')
    const nav = value.steps?.find(step => step.type === 'navigate')
    if (nav?.type === 'navigate' && nav.url.kind === 'literal') setPreviewUrl(nav.url.value)
  }
  const save = async () => {
    const saved = await window.electronAPI.saveScenario(draft)
    setDraft(saved); setDirty(false); setScenarios(await window.electronAPI.getScenarios())
    return saved
  }
  const titleRef = useRef<HTMLInputElement>(null)
  const [renaming, setRenaming] = useState<{ id: string; text: string } | null>(null)
  const [rowMenu, setRowMenu] = useState<{ x: number; y: number; scenario: Scenario } | null>(null)
  const toSave = (scenario: Scenario, patch: Partial<SaveScenarioInput> = {}): SaveScenarioInput => ({ id: scenario.id, title: scenario.title, code: scenario.code, headless: scenario.headless, mode: scenario.mode, steps: scenario.steps, profileId: scenario.profileId, saveSession: scenario.saveSession, autoSync: scenario.autoSync, ...patch })
  // Renames a saved scenario right away (works for any scenario in the list, open or not).
  const renameScenario = async (scenario: Scenario, raw: string) => {
    const title = raw.trim()
    setRenaming(null)
    if (!title || title === scenario.title) { if (!title) setMessage('نام سناریو نمی‌تواند خالی باشد.'); return }
    if (title.length > 120) { setMessage('نام سناریو نباید بیشتر از ۱۲۰ کاراکتر باشد.'); return }
    if (scenarios.some(item => item.id !== scenario.id && item.title.trim() === title) && !confirm('سناریوی دیگری با این نام وجود دارد. با همین نام ادامه می‌دهید؟')) return
    try {
      const saved = await window.electronAPI.saveScenario(toSave(scenario, { title }))
      setScenarios(await window.electronAPI.getScenarios())
      if (draft.id === scenario.id) setDraft(previous => ({ ...previous, title: saved.title }))
      setMessage('نام سناریو به «' + saved.title + '» تغییر کرد.')
    } catch (error) { setMessage('تغییر نام انجام نشد: ' + String(error)) }
  }
  const duplicateScenario = async (scenario: Scenario) => {
    try {
      const saved = await window.electronAPI.saveScenario(toSave(scenario, { id: undefined, title: (scenario.title + ' (کپی)').slice(0, 120) }))
      setScenarios(await window.electronAPI.getScenarios())
      setMessage('کپی ساخته شد: «' + saved.title + '»')
    } catch (error) { setMessage('کپی انجام نشد: ' + String(error)) }
  }
  const deleteScenarioById = async (scenario: Scenario) => {
    if (!confirm('سناریوی «' + scenario.title + '» حذف شود؟')) return
    try {
      await window.electronAPI.deleteScenario(scenario.id)
      setScenarios(await window.electronAPI.getScenarios())
      if (draft.id === scenario.id) { setDraft(fresh()); setSelectedId(''); setDirty(false); setRun(null); setPreview(null) }
      setMessage('سناریو حذف شد.')
    } catch (error) { setMessage(String(error)) }
  }
  const [tplOpen, setTplOpen] = useState(false)
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme === 'light' ? 'light' : 'dark')
  const toggleTheme = () => {
    const next = theme === 'light' ? 'dark' : 'light'
    setTheme(next); document.documentElement.dataset.theme = next
    try { localStorage.setItem('flowweb-theme', next) } catch { /* storage unavailable */ }
  }
  const useTemplate = (index: number) => {
    if (!allowSwitch()) return
    setDraft({ ...templates[index].scenario }); setSelectedId(''); setDirty(true); setRun(null); setPreview(null); setTplOpen(false)
    setMessage('قالب بارگذاری شد؛ آن را تغییر دهید و ذخیره کنید.')
  }
  const startNew = () => {
    if (!allowSwitch()) return
    load()
    setTimeout(() => { titleRef.current?.focus(); titleRef.current?.select() }, 60)
  }
  const doSave = async () => {
    if (!draft.title.trim()) { setMessage('اول یک نام برای سناریو بنویسید.'); titleRef.current?.focus(); return }
    setAction('save')
    try { await save(); setMessage('سناریو ذخیره شد.') }
    catch (error) { setMessage('ذخیره انجام نشد: ' + String(error)) }
    finally { setAction('') }
  }
  const execute = async () => {
    setAction('run'); setMessage(''); setPreview(null); setPreviewError('')
    try {
      const input = JSON.parse(inputText) as JsonValue
      const saved = await save()
      setRun(await window.electronAPI.enqueueRun(saved.id, { input, timeoutMs: timeoutText.trim() ? Number(timeoutText) : undefined }))
    } catch (error) { setMessage('اجرا شروع نشد: ' + String(error)) }
    finally { setAction('') }
  }
  const cancel = async () => {
    if (!run) return
    try { setRun(await window.electronAPI.cancelRun(run.id) ?? run) }
    catch (error) { setMessage(String(error)) }
  }
  const remove = async () => {
    if (!draft.id || !confirm('سناریوی «' + draft.title + '» حذف شود؟')) return
    setAction('delete')
    try {
      await window.electronAPI.deleteScenario(draft.id)
      setScenarios(await window.electronAPI.getScenarios()); setDraft(fresh()); setSelectedId(''); setDirty(false); setRun(null); setPreview(null); setMessage('سناریو حذف شد.')
    } catch (error) { setMessage(String(error)) }
    finally { setAction('') }
  }
  const insertStep = (index: number, type: ScenarioStep['type']) => {
    const step = createStep(type)
    if (step.type === 'field' || step.type === 'table' || step.type === 'screenshot') {
      const sameKind = (other: ScenarioStep['type']) => step.type === 'screenshot' ? other === 'screenshot' : other === 'field' || other === 'table'
      const names = new Set(steps.filter(s => sameKind(s.type)).map(s => (s as { name: string }).name))
      const base = step.name; let i = 2
      while (names.has(step.name)) step.name = base + i++
    }
    const next = [...steps]; next.splice(index, 0, step)
    change({ steps: next }); setSelectedId(step.id); setEditorOpen(true)
  }
  const deleteStep = (id: string) => {
    change({ steps: steps.filter(s => s.id !== id) })
    if (selectedId === id) { setSelectedId(''); setEditorOpen(false) }
  }
  const move = (index: number, offset: number) => {
    const reordered = [...steps]; const target = index + offset
    if (target < 0 || target >= steps.length) return
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    change({ steps: reordered })
  }
  const duplicate = (index: number) => {
    const original = steps[index]
    const copy = { ...structuredClone(original), id: crypto.randomUUID(), title: original.title + ' (کپی)' } as ScenarioStep
    if (copy.type === 'field' || copy.type === 'table' || copy.type === 'screenshot') {
      const sameKind = (type: ScenarioStep['type']) => copy.type === 'screenshot' ? type === 'screenshot' : type === 'field' || type === 'table'
      const used = new Set(steps.filter(s => sameKind(s.type)).map(s => (s as { name: string }).name))
      const base = copy.name; let i = 2
      while (used.has(copy.name)) copy.name = base + i++
    }
    if (copy.type === 'table') copy.columns = copy.columns.map(column => ({ ...column, id: crypto.randomUUID() }))
    const next = [...steps]; next.splice(index + 1, 0, copy)
    change({ steps: next }); setSelectedId(copy.id); setEditorOpen(true)
  }
  const dropStep = (fromId: string, targetId: string) => {
    const from = steps.findIndex(step => step.id === fromId), to = steps.findIndex(step => step.id === targetId)
    if (from < 0 || to < 0 || from === to) return
    const reordered = [...steps]; const [moved] = reordered.splice(from, 1); reordered.splice(to, 0, moved)
    change({ steps: reordered })
  }
  const captureProfile = async () => {
    if (profileName === null) return
    setAction('profile')
    try {
      const info = await window.electronAPI.captureProfile(profileName.trim(), undefined)
      setProfiles(await window.electronAPI.listProfiles()); change({ profileId: info.id }); setProfileName(null)
      setMessage('نشست مرورگر به‌عنوان پروفایل «' + info.name + '» ذخیره شد و برای این سناریو انتخاب شد.')
    } catch (error) { setMessage(String(error)) }
    finally { setAction('') }
  }
  const removeProfile = async (id: string) => {
    if (!confirm('این پروفایل و نشست ذخیره‌شده‌اش حذف شود؟')) return
    try {
      await window.electronAPI.deleteProfile(id)
      setProfiles(await window.electronAPI.listProfiles()); setScenarios(await window.electronAPI.getScenarios())
      if (draft.profileId === id) setDraft(previous => ({ ...previous, profileId: undefined, saveSession: undefined }))
    } catch (error) { setMessage(String(error)) }
  }
  const addSecret = async () => {
    try { setSecrets(await window.electronAPI.saveSecret(secretName.trim(), secretValue)); setSecretName(''); setSecretValue(''); setMessage('رمز ذخیره شد.') }
    catch (error) { setMessage(String(error)) }
  }
  const removeSecret = async (name: string) => {
    if (!confirm('رمز «' + name + '» حذف شود؟ سناریوهایی که از آن استفاده می‌کنند اجرا نمی‌شوند.')) return
    try { setSecrets(await window.electronAPI.deleteSecret(name)) } catch (error) { setMessage(String(error)) }
  }
  const openInspector = async (target = previewUrl) => {
    const url = normalizeUrl(target)
    if (!url) { setMessage('آدرس سایت معتبر نیست؛ مثلاً example.com یا https://example.com/login'); return }
    setPreviewUrl(url); testCursor.current = null; openedProfile.current = draft.profileId ?? ''
    setAction('open')
    try { await window.electronAPI.openInspector(url, draft.profileId); setInspectorOpen(true); setMessage('مرورگر آماده است. عنصر را انتخاب یا مرحله را روی صفحه فعلی تست کنید.') }
    catch (error) { setMessage(String(error)); setInspectorOpen(false) }
    finally { setAction('') }
  }
  const closeInspector = async () => {
    try { await window.electronAPI.closeInspector(); setInspectorOpen(false); testCursor.current = null }
    catch (error) { setMessage(String(error)) }
  }
  const pick = async (request: PickRequest, apply: (selector: string) => void) => {
    setAction('pick'); setMessage('در مرورگر آزمایشی روی عنصر کلیک کنید؛ Escape انتخاب را لغو می‌کند.')
    try {
      const result = await window.electronAPI.pickElement(request)
      if (result) { apply(result.selector); setMessage('انتخاب انجام شد · ' + result.count + ' عنصر · ' + result.text) }
      else setMessage('انتخاب لغو شد.')
    } catch (error) { setMessage('انتخاب انجام نشد: ' + String(error)) }
    finally { setAction('') }
  }
  // Test runs continue where the previous test stopped (the page is already in that state), so only the new
  // nodes run. A restart from node 1 happens when earlier nodes changed, the browser/profile changed, or the
  // user asks for it; it asks first when that would repeat nodes that change data on the site.
  const openedProfile = useRef('')
  const testCursor = useRef<{ count: number; sig: string; profile: string } | null>(null)
  const testResults = useRef<StepResult[]>([])
  const mutating = new Set(['click', 'fill', 'press', 'select', 'check', 'form', 'code', 'tab', 'dialog'])
  const testStep = async (target: ScenarioStep | undefined = selected, fresh = false) => {
    if (!target) return
    const index = steps.findIndex(step => step.id === target.id)
    if (index < 0) return
    const profile = draft.profileId ?? ''
    const sigOf = (count: number) => JSON.stringify(steps.slice(0, count)) + '|' + inputText
    const cursor = testCursor.current
    let from = 0
    if (!fresh && cursor && cursor.profile === profile && cursor.count <= index + 1 && cursor.sig === sigOf(cursor.count)) from = cursor.count === index + 1 ? index : cursor.count
    if (from === 0 && cursor && cursor.count > 0) {
      const repeated = steps.slice(0, index + 1).filter(step => mutating.has(step.type)).length
      if (repeated && !confirm('این تست از نود ۱ دوباره شروع می‌شود و ' + repeated + ' نود کلیک/واردکردن/انتخاب را تکرار می‌کند؛ اگر در سایت ثبت یا ارسال انجام می‌دهند، دوباره انجام می‌شوند. ادامه می‌دهید؟')) return
    }
    const upTo = steps.slice(from, index + 1)
    const keep = from > 0 ? testResults.current.filter(item => steps.slice(0, from).some(step => step.id === item.id)) : []
    setAction('preview'); setPreview({ output: null, results: keep }); setPreviewError(''); setSuggest(null)
    const seen: StepResult[] = [...keep]
    const stop = window.electronAPI.onPreviewProgress(result => {
      const at = seen.findIndex(item => item.id === result.id)
      if (at < 0) seen.push(result); else seen[at] = result
      setPreview({ output: null, results: [...seen] })
    })
    try {
      const result = await window.electronAPI.previewStep(upTo, JSON.parse(inputText))
      const merged = [...keep, ...result.results.filter(item => !keep.some(old => old.id === item.id))]
      testResults.current = merged; testCursor.current = { count: index + 1, sig: sigOf(index + 1), profile }
      setPreview({ output: result.output, results: merged })
      setMessage((from > 0 ? 'ادامه از نود ' + (from + 1) : 'اجرا از نود ۱') + ' تا نود ' + (index + 1) + ' کامل شد. حالا نود بعدی را انتخاب کنید.')
      setSuggest({ id: target.id, tick: Date.now() })
    } catch (error) {
      testCursor.current = null
      setPreviewError(String(error))
      const failed: StepResult = { id: target.id, title: target.title, status: 'failed', error: String(error) }
      setPreview({ output: null, results: [...seen.filter(item => item.status !== 'running'), ...(seen.some(item => item.status === 'failed') ? [] : [failed])] })
    }
    finally { stop(); setAction('') }
  }
  const saveSettings = async () => {
    if (!settings) return
    setAction('settings')
    try { const applied = await window.electronAPI.saveSettings(settings); setSettings(applied); setSavedSettings(applied); setSettingsVersion(version => version + 1); setMessage('تنظیمات ذخیره و روی سرور اعمال شد.') }
    catch (error) { setMessage('خطا در تنظیمات: ' + String(error)) }
    finally { setAction('') }
  }
  const autoSync = draft.autoSync !== false
  // Code -> nodes. Returns false when nothing in the code could be turned into nodes.
  const codeToNodes = (code: string, source: 'record' | 'code') => {
    const result = codeToSteps(code)
    if (!result.steps.length) { setReport({ count: 0, skipped: result.skipped, exact: false, source }); setMessage('در این کد دستوری که به نود تبدیل شود پیدا نشد.'); return false }
    synced.current = { steps: JSON.stringify(result.steps), code }
    change({ code, steps: result.steps, mode: 'steps' })
    setSelectedId(result.steps[0].id); setEditorOpen(false)
    setReport({ count: result.steps.length, skipped: result.skipped, exact: result.exact, custom: result.custom, source })
    return true
  }
  // Nodes -> readable code. Keeps the current code when it is already in sync with the nodes.
  const nodesToCode = (force = false) => {
    const current = JSON.stringify(steps)
    if (!force && synced.current.steps === current && draft.code.trim()) return draft.code
    const code = stepsToCode(steps)
    synced.current = { steps: current, code }
    return code
  }
  const switchMode = (mode: 'steps' | 'code') => {
    if (mode === (draft.mode === 'steps' ? 'steps' : 'code')) return
    if (mode === 'code') {
      if (autoSync && steps.length) {
        const codeEdited = draft.code.trim() && draft.code !== synced.current.code
        if (codeEdited && JSON.stringify(steps) !== synced.current.steps && !confirm('کد دستی شما با کد ساخته‌شده از نودها جایگزین می‌شود. ادامه می‌دهید؟')) return
        if (codeEdited && JSON.stringify(steps) === synced.current.steps) { change({ mode: 'code' }); return }
        const code = nodesToCode(); change({ mode: 'code', code })
      } else change({ mode: 'code' })
      return
    }
    // code -> nodes: only re-parse when the code was edited after the last sync
    if (autoSync && draft.code.trim() && draft.code !== synced.current.code) {
      const nodesEdited = !!synced.current.steps && JSON.stringify(steps) !== synced.current.steps
      if (nodesEdited && !confirm('هم کد و هم نودها بعد از آخرین هم‌گام‌سازی تغییر کرده‌اند. ادامه دهید، نودهای فعلی با نودهای ساخته‌شده از کد جایگزین می‌شوند و تغییرات دستی نودها از بین می‌رود.')) return
      const probe = codeToSteps(draft.code)
      if (probe.skipped.length && !confirm(probe.skipped.length + ' دستور کد به نود تبدیل نمی‌شود و در حالت مراحل بصری اجرا نخواهد شد. ادامه می‌دهید؟')) return
      codeToNodes(draft.code, 'code')
      return
    }
    change({ mode: 'steps', steps: steps.length ? steps : [createStep('navigate')] })
  }
  const record = async () => {
    const url = codeUrl.trim() ? normalizeUrl(codeUrl) : undefined
    if (url === null) { setMessage('آدرس سایت معتبر نیست؛ مثلاً example.com یا https://example.com/login'); return }
    if (url) setCodeUrl(url)
    setAction('record'); setMessage('برای پایان ضبط، مرورگر ضبط را ببندید.')
    try {
      const code = await window.electronAPI.recordCodegen(url)
      if (autoSync) {
        if (codeToNodes(code, 'record')) setMessage('ضبط تمام شد؛ نودها خودکار در حالت دستی ساخته شدند.')
        else change({ code, mode: 'code' })
      } else change({ code, mode: 'code' })
    }
    catch (error) { setMessage(String(error)) }
    finally { setAction('') }
  }
  // ---- advanced code editor helpers: URL entry and right-click snippets ----
  const insertAtCursor = (text: string) => {
    const { start, end } = caret.current
    const code = draft.code
    const needsBreak = start > 0 && code[start - 1] !== '\n' && text.startsWith('await')
    const insert = (needsBreak ? '\n' : '') + text
    change({ code: code.slice(0, start) + insert + code.slice(end) })
    const position = start + insert.length
    caret.current = { start: position, end: position }
    setTimeout(() => { codeArea.current?.focus(); codeArea.current?.setSelectionRange(position, position) }, 0)
  }
  const openCodeUrl = async () => {
    const url = normalizeUrl(codeUrl)
    if (!url) { setMessage('آدرس سایت معتبر نیست؛ مثلاً example.com یا https://example.com/login'); return }
    setCodeUrl(url)
    await openInspector(url)
  }
  const insertGoto = () => {
    const url = normalizeUrl(codeUrl)
    if (!url) { setMessage('ابتدا آدرس سایت را وارد کنید.'); return }
    setCodeUrl(url)
    caret.current = { start: 0, end: 0 }
    insertAtCursor('await page.goto(' + JSON.stringify(url) + ", { waitUntil: 'domcontentloaded' })\n")
  }
  const codeMenuItems = (): MenuItem[] => {
    const snippet = (label: string, icon: string, build: (selector: string) => string): MenuItem => ({ label, icon, onClick: () => insertAtCursor(build('SELECTOR')) })
    const picked = (label: string, icon: string, build: (selector: string) => string): MenuItem => ({
      label, icon, disabled: !inspectorOpen, hint: inspectorOpen ? '' : 'مرورگر را باز کنید',
      onClick: () => { void pick({ kind: 'element' }, selector => insertAtCursor(build(selector))) }
    })
    const q = (selector: string) => 'page.locator(' + JSON.stringify(selector) + ')'
    return [
      { kind: 'header', label: 'عنصر از صفحه (مرورگر آزمایشی)' },
      picked('درج کلیک روی عنصر انتخاب‌شده', '⌖', s => 'await ' + q(s) + '.click()\n'),
      picked('درج خواندن متن عنصر انتخاب‌شده', '⌗', s => 'const text = await ' + q(s) + '.innerText()\n'),
      picked('درج locator عنصر انتخاب‌شده', '◎', s => q(s)),
      { kind: 'separator' },
      { kind: 'header', label: 'درج دستور' },
      snippet('رفتن به صفحه (goto)', '🌐', () => 'await page.goto(' + JSON.stringify(normalizeUrl(codeUrl) ?? 'https://example.com') + ", { waitUntil: 'domcontentloaded' })\n"),
      snippet('کلیک', '↖', s => 'await page.locator(' + JSON.stringify(s) + ').click()\n'),
      snippet('نوشتن در کادر (fill)', '⌨', s => 'await page.locator(' + JSON.stringify(s) + ").fill('')\n"),
      snippet('فشردن کلید', '⏎', () => "await page.keyboard.press('Enter')\n"),
      snippet('انتخاب از لیست', '☰', s => 'await page.locator(' + JSON.stringify(s) + ").selectOption('')\n"),
      snippet('تیک زدن', '☑', s => 'await page.locator(' + JSON.stringify(s) + ').check()\n'),
      snippet('انتظار برای عنصر', '⏳', s => 'await page.locator(' + JSON.stringify(s) + ").waitFor({ state: 'visible' })\n"),
      snippet('ماندن در صفحه (۳ ثانیه)', '⏱', () => 'await page.waitForTimeout(3000)\n'),
      snippet('اسکرول به پایین', '⇅', () => 'await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight }))\n'),
      snippet('اسکرین‌شات', '▣', () => "await page.screenshot({ path: 'shot-page.png', fullPage: true })\n"),
      snippet('خواندن مقدار و بازگرداندن خروجی', '↩', s => 'const value = await page.locator(' + JSON.stringify(s) + ').innerText()\nreturn { value }\n'),
      { kind: 'separator' },
      { label: 'ورود به آدرس سایت (مرورگر آزمایشی)', icon: '↗', disabled: !codeUrl.trim(), onClick: () => { void openCodeUrl() } },
      { label: 'تبدیل کد به نودها', icon: '⇢', disabled: !draft.code.trim(), onClick: () => { const probe = codeToSteps(draft.code); if (probe.skipped.length && !confirm(probe.skipped.length + ' دستور کد به نود تبدیل نمی‌شود. ادامه می‌دهید؟')) return; codeToNodes(draft.code, 'code') } }
    ]
  }

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'F2' && section === 'studio' && !locked) { event.preventDefault(); const current = scenarios.find(item => item.id === draft.id); if (current) setRenaming({ id: current.id, text: current.title }); else { titleRef.current?.focus(); titleRef.current?.select() }; return }
      if (!(event.ctrlKey || event.metaKey) || section !== 'studio') return
      if (event.key.toLowerCase() === 's') { event.preventDefault(); if (!locked) void doSave() }
      else if (event.key === 'Enter') { event.preventDefault(); if (!locked && !activeRun) void execute() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
  const stepsDone = (run?.stepResults ?? []).filter(result => result.status === 'passed' || result.continued).length
  const progress = (id: string) => (preview?.results ?? run?.stepResults ?? []).find(result => result.id === id)
  const visibleScenarios = scenarios.filter(item => item.title.includes(search))

  return <div className="studio-shell" dir="rtl">
    <aside className={'sidebar ' + (sidebarOpen ? 'open' : '')}>
      <div className="brand"><div className="brand-mark"><img src="./brand-glyph.png" alt="" /></div><div><strong>WebAutomation</strong><span>powered by portmort</span></div><button className="sidebar-toggle" aria-label="منوی سناریوها" aria-expanded={sidebarOpen} onClick={() => setSidebarOpen(!sidebarOpen)}>{sidebarOpen ? '×' : '☰'}</button></div>
      <button className="new-scenario" disabled={locked} onClick={startNew}>＋ سناریو جدید</button>
      <button disabled={locked} onClick={() => setTplOpen(true)}>✨ شروع از قالب آماده</button>
      <div className="sidebar-heading"><span>سناریوهای من</span><span>{scenarios.length}</span></div>
      <input className="search" aria-label="جستجوی سناریو" placeholder="جستجوی سناریو…" value={search} onChange={e => setSearch(e.target.value)} />
      <nav className="scenario-list" aria-label="سناریوها">{visibleScenarios.map(scenario => <div key={scenario.id} className={'scenario-row ' + (draft.id === scenario.id ? 'selected' : '')} onContextMenu={event => { event.preventDefault(); if (!locked) setRowMenu({ x: event.clientX, y: event.clientY, scenario }) }}>
        {renaming?.id === scenario.id
          ? <div className="scenario-item selected renaming"><span className="scenario-symbol">✎</span><input autoFocus aria-label="نام جدید سناریو" maxLength={120} value={renaming.text} onChange={e => setRenaming({ id: scenario.id, text: e.target.value })} onFocus={e => e.currentTarget.select()} onKeyDown={e => { if (e.key === 'Enter') void renameScenario(scenario, renaming.text); if (e.key === 'Escape') setRenaming(null) }} onBlur={() => void renameScenario(scenario, renaming.text)} /></div>
          : <><button disabled={locked} className={'scenario-item ' + (draft.id === scenario.id ? 'selected' : '')} onClick={() => load(scenario)} onDoubleClick={() => { if (!locked) setRenaming({ id: scenario.id, text: scenario.title }) }} title="دوبار کلیک یا کلیک راست برای تغییر نام"><span className="scenario-symbol">{scenario.mode === 'steps' ? '▦' : '⌘'}</span><span><strong>{scenario.title}</strong><small>{scenario.mode === 'steps' ? (scenario.steps?.length ?? 0) + ' مرحله' : 'کد پیشرفته'}</small></span><span className="scenario-dot" /></button>
            <button className="row-rename" disabled={locked} aria-label={'تغییر نام ' + scenario.title} title="تغییر نام" onClick={() => setRenaming({ id: scenario.id, text: scenario.title })}>✎</button></>}
      </div>)}{!visibleScenarios.length && <p className="sidebar-empty">{search ? 'سناریویی پیدا نشد.' : 'اولین جریان کاری‌ات را بساز.'}</p>}</nav>
      <div className="sidebar-bottom"><button className="theme-toggle" onClick={toggleTheme}>{theme === 'light' ? '🌙 حالت تیره' : '☀ حالت روشن'}</button><button className={section === 'settings' ? 'selected' : ''} onClick={() => setSection(section === 'settings' ? 'studio' : 'settings')}>⚙ تنظیمات اتصال</button><div className="connection-note"><span className="status-dot" />مرورگر ← داده ← n8n</div></div>
    </aside>
    {tplOpen && <div className="modal-backdrop" onClick={() => setTplOpen(false)}><div className="modal" role="dialog" aria-label="قالب‌های آماده" onClick={e => e.stopPropagation()}>
      <header><div><h2>قالب‌های آماده</h2><p>یکی را انتخاب کنید و بعد مطابق سایت خودتان ویرایش کنید.</p></div><button onClick={() => setTplOpen(false)}>بستن</button></header>
      <div className="tpl-grid">{templates.map((t, i) => <button key={t.title} className="tpl-card" onClick={() => useTemplate(i)}><span>{t.icon}</span><strong>{t.title}</strong><small>{t.description}</small></button>)}</div>
    </div></div>}
    <main className="workspace">
      <header className="workspace-header"><div className="breadcrumbs">فضای کار <span>/</span> {section === 'settings' ? 'تنظیمات اتصال' : 'طراحی سناریو'}</div><span className="header-note">داده‌های وب، آماده برای گردش کار شما</span></header>
      {message && <div className="notice" role="status"><span>{message}</span><button aria-label="بستن پیام" onClick={() => setMessage('')}>×</button></div>}
      {section === 'settings' ? <SettingsPage settings={settings} savedSettings={savedSettings} settingsVersion={settingsVersion} scenarios={scenarios.map(item => ({ id: item.id, title: item.title }))} setSettings={setSettings} secrets={secrets} profiles={profiles} secretName={secretName} secretValue={secretValue} setSecretName={setSecretName} setSecretValue={setSecretValue} addSecret={addSecret} removeSecret={removeSecret} removeProfile={removeProfile} scenarioId={draft.id} busy={!!action} onSave={saveSettings} onBack={() => setSection('studio')} /> : <>
        <div className="scenario-header"><div className="scenario-title"><div className="eyebrow">SCENARIO BUILDER <span className="draft-state">{dirty ? 'تغییرات ذخیره نشده' : draft.id ? 'ذخیره شده' : 'پیش‌نویس'}</span></div><div className="title-edit"><input ref={titleRef} aria-label="عنوان سناریو" placeholder="نام سناریو را بنویسید…" maxLength={120} value={draft.title} disabled={locked} onChange={e => change({ title: e.target.value })} onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); void doSave() } }} /><span className="title-pencil" aria-hidden="true">✎</span></div>{!draft.title.trim() && <span className="hint warn">برای ذخیره، نام سناریو لازم است.</span>}</div><div className="header-actions"><button disabled={locked} onClick={doSave}>ذخیره سناریو</button><button className="api-button" aria-label="دستور API این سناریو" title="دستور آمادهٔ API و n8n برای این سناریو" onClick={() => setApiDialog(true)}>&lt;/&gt; API</button>{activeRun && <span className="run-progress" role="status">{run?.status === 'queued' ? 'در صف…' : 'مرحله ' + Math.min(stepsDone + 1, Math.max(steps.length, 1)) + ' از ' + steps.length}</span>}{activeRun ? <button className="danger-button" disabled={run?.status === 'cancelling'} onClick={cancel}>{run?.status === 'cancelling' ? 'در حال لغو…' : 'لغو اجرا'}</button> : <button className="primary" disabled={locked} onClick={execute}>▶ اجرای سناریو</button>}</div></div>
        <div className="design-toolbar"><div className="segmented"><button className={draft.mode === 'steps' ? 'active' : ''} disabled={locked} onClick={() => switchMode('steps')}>مراحل بصری</button><button className={draft.mode !== 'steps' ? 'active' : ''} disabled={locked} onClick={() => switchMode('code')}>کد پیشرفته</button></div><div className="toolbar-actions"><label className="profile-select">نشست<select aria-label="پروفایل نشست" disabled={locked} value={draft.profileId ?? ''} onChange={e => change({ profileId: e.target.value || undefined, saveSession: e.target.value ? draft.saveSession : undefined })}><option value="">بدون ورود</option>{profiles.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>{draft.profileId && <label className="check"><input type="checkbox" aria-label="ذخیره نشست بعد از اجرا" disabled={locked} checked={draft.saveSession === true} onChange={e => change({ saveSession: e.target.checked })} />به‌روزرسانی نشست پس از اجرا</label>}<label className="check"><input aria-label="Playwright Headless" type="checkbox" disabled={locked} checked={draft.headless} onChange={e => change({ headless: e.target.checked })} />اجرای بدون نمایش مرورگر</label><button className={'text-button ' + (showInput ? 'active' : '')} onClick={() => setShowInput(!showInput)}>ورودی اجرا {showInput ? '⌃' : '⌄'}</button>{draft.id && <button className="icon-button danger" aria-label="حذف سناریو" disabled={locked} onClick={remove}>×</button>}</div></div>
        {showInput && <div className="run-inputs"><label>ورودی JSON<textarea aria-label="ورودی JSON" dir="ltr" disabled={locked} value={inputText} onChange={e => { setInputText(e.target.value); setPreview(null); setPreviewError('') }} spellCheck={false} /></label><label>مهلت این اجرا (اختیاری)<input aria-label="Timeout اجرا" dir="ltr" disabled={locked} type="number" min={1000} max={3600000} placeholder="پیش‌فرض سرور" value={timeoutText} onChange={e => setTimeoutText(e.target.value)} /><span className="hint">مقادیر را با مسیرهایی مانند <code>orderId</code> در مراحل استفاده کنید.</span></label></div>}
        {report && <div className={'convert-report ' + (report.count ? '' : 'empty')} role="status"><div><strong>{report.count ? report.count + ' نود از ' + (report.source === 'record' ? 'کد ضبط‌شده' : 'کد') + ' ساخته شد' + (report.exact ? ' (همه دستورها حفظ شد)' : '') : 'نودی ساخته نشد'}</strong>{!!report.custom && <span> · {report.custom} نود «کد سفارشی» برای دستورهای خاص (همان کد اصلی اجرا می‌شود)</span>}{report.skipped.length > 0 && <span> · {report.skipped.length} دستور پشتیبانی نشد</span>}</div>{report.skipped.length > 0 && <details><summary>مشاهده دستورهای تبدیل‌نشده</summary><pre dir="ltr">{report.skipped.join('\n')}</pre><p className="hint">این دستورها در حالت «مراحل بصری» اجرا نمی‌شوند. اگر لازمشان دارید، به «کد پیشرفته» برگردید؛ کد اصلی تا ذخیره‌کردن حفظ می‌شود.</p></details>}<div className="report-actions">{report.skipped.length > 0 && draft.mode === 'steps' && <button onClick={() => { setDraft(previous => ({ ...previous, mode: 'code' })); setDirty(true); setReport(null) }}>برگشت به کد اصلی</button>}<button className="icon-button" aria-label="بستن گزارش تبدیل" onClick={() => setReport(null)}>×</button></div></div>}
        <div className={'design-area ' + (focusOutput ? 'result-focus' : '')}>
          {draft.mode === 'steps' ? <div className={'builder ' + (editorOpen && selected ? 'with-editor' : '')}>
            <Canvas steps={steps} selectedId={editorOpen ? selected?.id ?? '' : ''} results={preview?.results ?? run?.stepResults ?? []} locked={locked} running={activeRun} outputNames={steps.filter(s => s.type === 'field' || s.type === 'table').map(s => (s as { name: string }).name)} canTest={inspectorOpen} suggestAfter={suggest}
              onSelect={id => { setSelectedId(id); setEditorOpen(true); setPreview(null); setPreviewError('') }} onInsert={insertStep} onDelete={deleteStep} onDuplicate={duplicate} onDrop={dropStep}
              onTest={(id, fresh) => { const target = steps.find(s => s.id === id); if (target) { setSelectedId(id); void testStep(target, fresh) } }} onStart={() => setShowInput(true)} onMove={(id, offset) => { const index = steps.findIndex(s => s.id === id); if (index >= 0) move(index, offset) }} onFocusInput={() => setShowInput(true)} />
            {editorOpen && selected && <section className="editor-panel drawer"><button className="drawer-close" aria-label="بستن ویرایشگر نود" onClick={() => setEditorOpen(false)}>×</button><div className="browser-bar"><div><span className={'status-dot ' + (inspectorOpen ? '' : 'off')} /><strong>مرورگر آزمایشی</strong><span className="muted">{inspectorOpen ? 'نشست باز است' : 'برای انتخاب عناصر باز کنید'}</span></div><div className="input-action"><input dir="ltr" aria-label="آدرس مرورگر آزمایشی" disabled={locked} value={previewUrl} onChange={e => setPreviewUrl(e.target.value)} /><button disabled={locked} onClick={() => openInspector()}>{action === 'open' ? 'در حال بازکردن…' : 'بازکردن مرورگر'}</button>{inspectorOpen && <button className="icon-button" disabled={locked} aria-label="بستن مرورگر آزمایشی" onClick={closeInspector}>×</button>}</div>{inspectorOpen && (profileName === null ? <button className="text-button" disabled={locked} onClick={() => setProfileName('')}>ذخیره نشست مرورگر (ورود)</button> : <div className="input-action"><input aria-label="نام پروفایل" autoFocus placeholder="نام پروفایل، مثلاً حساب فروشگاه" value={profileName} onChange={e => setProfileName(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void captureProfile(); if (e.key === 'Escape') setProfileName(null) }} /><button className="pick-button" disabled={!profileName.trim() || !!action} onClick={captureProfile}>ذخیره</button><button className="icon-button" aria-label="انصراف" onClick={() => setProfileName(null)}>×</button></div>)}{action === 'pick' && <button className="text-button" onClick={() => window.electronAPI.cancelPick().catch(error => setMessage(String(error)))}>لغو انتخاب عنصر</button>}</div>
              <div className="editor-scroll">{selected ? <StepEditor step={selected} onChange={changeStep} pick={pick} canPick={inspectorOpen && !locked} locked={locked} secretNames={secrets.map(item => item.name)} /> : <div className="blank-editor"><span>＋</span><h2>اولین مرحله را اضافه کنید</h2><p>از بازکردن صفحه شروع کنید و داده‌های موردنیاز را استخراج کنید.</p></div>}</div>
              <div className="step-test-bar"><div><strong>اجرا تا همین نود</strong><span>از جایی که تست قبلی تمام شده ادامه می‌دهد؛ اگر نودهای قبلی تغییر کرده باشند از نود ۱ شروع می‌کند.</span></div>{inspectorOpen && openedProfile.current !== (draft.profileId ?? '') && <span className="hint warn">پروفایل نشست بعد از باز شدن مرورگر عوض شده؛ مرورگر آزمایشی را دوباره باز کنید.</span>}<button className="text-button" disabled={!selected || !inspectorOpen || locked} onClick={() => testStep(selected, true)}>از نود ۱</button><button disabled={!selected || !inspectorOpen || locked} onClick={() => testStep()}>{action === 'preview' ? 'در حال اجرا…' : '▷ اجرا تا این نود'}</button></div>
            </section>}
          </div> : <section className="code-panel"><div className="section-heading"><div><h2>کد سناریو</h2><p className="hint"><code>input</code>، <code>page</code>، <code>context</code> و <code>browser</code> آماده‌اند. خروجی را با <code>return</code> برگردانید.</p></div><button disabled={locked} onClick={record}>{action === 'record' ? 'در حال ضبط…' : '● ضبط با Codegen'}</button></div><div className="url-bar"><label>آدرس سایت<div className="input-action"><input dir="ltr" aria-label="آدرس سایت" inputMode="url" placeholder="example.com یا https://example.com/login" value={codeUrl} disabled={locked} onChange={e => setCodeUrl(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') void openCodeUrl() }} /><button className="pick-button" disabled={locked || !codeUrl.trim()} onClick={() => void openCodeUrl()}>{action === 'open' ? 'در حال ورود…' : '↗ ورود به صفحه'}</button><button disabled={locked || !codeUrl.trim()} onClick={insertGoto}>درج goto در کد</button></div></label><span className="hint">با «ورود به صفحه» مرورگر آزمایشی مستقیم همان آدرس را باز می‌کند؛ «ضبط با Codegen» هم از همین آدرس شروع می‌شود. برای افزودن دستور یا عنصر، داخل کد راست‌کلیک کنید.</span></div><div className="sync-bar"><label className="check"><input type="checkbox" aria-label="همگام‌سازی خودکار کد و نودها" disabled={locked} checked={autoSync} onChange={e => change({ autoSync: e.target.checked })} />همگام‌سازی خودکار: بعد از ضبط، نودها در حالت دستی ساخته شوند و با تغییر حالت، کد و نودها یکدیگر را به‌روز کنند</label><div className="sync-actions"><button disabled={locked || !draft.code.trim()} onClick={() => { const probe = codeToSteps(draft.code); if (probe.skipped.length && !confirm(probe.skipped.length + ' دستور کد به نود تبدیل نمی‌شود. ادامه می‌دهید؟')) return; codeToNodes(draft.code, 'code') }}>⇢ تبدیل کد به نودها</button><button disabled={locked || !steps.length} onClick={() => { if (draft.code.trim() && draft.code !== synced.current.code && !confirm('کد فعلی با کد ساخته‌شده از نودها جایگزین می‌شود. ادامه می‌دهید؟')) return; change({ code: nodesToCode(true) }) }}>⇠ ساخت کد از نودها</button></div></div><textarea aria-label="کد سناریو" ref={codeArea} onSelect={e => { caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd } }} onContextMenu={e => { e.preventDefault(); caret.current = { start: e.currentTarget.selectionStart, end: e.currentTarget.selectionEnd }; setCodeMenu({ x: e.clientX, y: e.clientY }) }} placeholder="// کد پلی‌رایت خود را بنویسید..." disabled={locked} value={draft.code} spellCheck={false} onChange={e => change({ code: e.target.value })} /></section>}
          <OutputPanel run={run} preview={preview} previewError={previewError} expanded={focusOutput} onExpand={() => setFocusOutput(!focusOutput)} history={history} onOpenRun={openRun} />
        </div>
      </>}
    </main>
    {apiDialog && <ApiDialog settings={settings} scenario={{ id: draft.id, title: draft.title }} inputText={inputText} dirty={dirty} onClose={() => setApiDialog(false)} onOpenSettings={() => { setApiDialog(false); setSection('settings') }} />}
    {rowMenu && <ContextMenu x={rowMenu.x} y={rowMenu.y} label="منوی سناریو" onClose={() => setRowMenu(null)} items={[
      { kind: 'header', label: rowMenu.scenario.title.slice(0, 40) },
      { label: 'تغییر نام', icon: '✎', hint: 'F2', onClick: () => setRenaming({ id: rowMenu.scenario.id, text: rowMenu.scenario.title }) },
      { label: 'باز کردن', icon: '↗', onClick: () => load(rowMenu.scenario) },
      { label: 'ساخت کپی', icon: '⧉', onClick: () => void duplicateScenario(rowMenu.scenario) },
      { kind: 'separator' },
      { label: 'حذف سناریو', icon: '✕', danger: true, onClick: () => void deleteScenarioById(rowMenu.scenario) }
    ]} />}
    {codeMenu && <ContextMenu x={codeMenu.x} y={codeMenu.y} items={codeMenuItems()} label="دستورهای کد" onClose={() => setCodeMenu(null)} />}
  </div>
}
