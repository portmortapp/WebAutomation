import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import type { JsonValue, PickRequest, PickResult, ScenarioStep, StepResult, StepPreview } from '../shared/types'
import { validateSteps } from '../shared/steps'
import { validateRunRequest } from '../shared/validation'
import { executeSteps } from './step-engine'

export class Inspector {
  private browser?: Browser
  private page?: Page
  private context?: BrowserContext
  private profileKey = ''
  private busy = false

  private async exclusive<T>(action: () => Promise<T>): Promise<T> {
    if (this.busy) throw new Error('مرورگر آزمایشی مشغول است؛ ابتدا انتخاب یا تست جاری را تمام کنید.')
    this.busy = true
    try { return await action() } finally { this.busy = false }
  }

  async open(url: string, storageState?: unknown, profileKey = '') {
    return this.exclusive(async () => {
      if (typeof url !== 'string' || !/^(https?:|file:|data:text\/html)/i.test(url)) throw new Error('آدرس صفحه معتبر نیست.')
      // A different saved session needs a fresh browser context, so the window is reopened.
      if (!this.browser?.isConnected() || !this.page || this.page.isClosed() || this.profileKey !== profileKey) {
        await this.browser?.close()
        this.browser = await chromium.launch({ headless: false })
        this.context = await this.browser.newContext(storageState ? { storageState: storageState as any } : {})
        this.page = await this.context.newPage()
        // A link that opens a new tab or popup becomes the page that tests and the picker work on.
        this.context.on('page', popup => {
          this.page = popup
          popup.once('close', () => { const open = this.context?.pages().filter(item => !item.isClosed()) ?? []; if (this.page === popup && open.length) this.page = open[open.length - 1] })
        })
        this.profileKey = profileKey
      }
      if (!this.page || this.page.isClosed()) this.page = this.context!.pages().find(item => !item.isClosed()) ?? await this.context!.newPage()
      await this.page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 })
      await this.page.bringToFront()
    })
  }

  private currentPage() {
    if (!this.page || this.page.isClosed()) throw new Error('ابتدا مرورگر آزمایشی را با آدرس صفحه باز کنید.')
    return this.page
  }

  async close() {
    const browser = this.browser
    this.browser = undefined
    this.page = undefined
    this.context = undefined
    this.profileKey = ''
    await browser?.close()
  }

  // Cookies and local storage of the test browser, used to save a login as a reusable profile.
  async captureSession() {
    if (!this.context || !this.page || this.page.isClosed()) throw new Error('ابتدا مرورگر آزمایشی را باز کنید و وارد حساب شوید.')
    return this.context.storageState()
  }

  async preview(stepOrSteps: ScenarioStep | ScenarioStep[], input: JsonValue, secrets: Record<string, string> = {}, onProgress?: (result: StepResult) => void): Promise<StepPreview> {
    return this.exclusive(async () => {
      const list = Array.isArray(stepOrSteps) ? stepOrSteps : [stepOrSteps]
      if (!list.length || list.length > 100) throw new Error('تعداد مرحله‌های تست نامعتبر است.')
      validateSteps(list)
      // Tests are quick checks: a long pause is shortened to 2 s (full runs wait the configured time).
      const toRun = list.map(item => item.type === 'pause' ? { ...item, seconds: Math.min(item.seconds, 2) } : item)
      const validated = validateRunRequest({ input })
      const results: StepResult[] = []
      let timer: ReturnType<typeof setTimeout> | undefined
      const limit = list.length > 1 ? 180000 : 45000
      try {
        const output = await Promise.race([
          executeSteps(this.currentPage(), toRun, validated.input!, async result => {
            const index = results.findIndex(item => item.id === result.id)
            if (index < 0) results.push(result); else results[index] = result
            try { onProgress?.(result) } catch { /* window closed */ }
          }, secrets),
          new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { void this.close(); reject(new Error('تست بیشتر از ' + Math.round(limit / 1000) + ' ثانیه طول کشید؛ مرورگر آزمایشی بسته شد.')) }, limit) })
        ])
        // Preview is explicitly a sample; full runs retain every extracted row.
        const sample = Object.fromEntries(Object.entries(output).map(([key, value]) => [key, Array.isArray(value) ? value.slice(0, 20) : value]))
        if (JSON.stringify(sample).length > 1_000_000) throw new Error('پیش‌نمایش بیش از حد بزرگ است.')
        return { output: sample, results }
      } finally { clearTimeout(timer) }
    })
  }

  async cancelPick() {
    if (this.page && !this.page.isClosed()) await this.page.evaluate(() => (window as any).__automationCancelPick?.())
  }

  async pick(request: PickRequest): Promise<PickResult | null> {
    return this.exclusive(async () => {
      if (!request || !['element', 'rows', 'column'].includes(request.kind)) throw new Error('نوع انتخاب نامعتبر است.')
      if (request.kind === 'column' && !request.rowSelector?.trim()) throw new Error('ابتدا ردیف‌های جدول را انتخاب کنید.')
      const page = this.currentPage()
      await page.bringToFront()
      return page.evaluate((options): Promise<PickResult | null> => new Promise((resolve, reject) => {
        const box = document.createElement('div')
        box.setAttribute('data-automation-picker', 'outline')
        box.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px solid #19a98e;background:#19a98e22;border-radius:3px;display:none;box-sizing:border-box;'
        const banner = document.createElement('div')
        banner.setAttribute('data-automation-picker', 'banner')
        banner.textContent = (options.kind === 'rows' ? 'یک ردیف جدول را انتخاب کنید' : options.kind === 'column' ? 'یک سلول از ستون موردنظر را انتخاب کنید' : 'عنصر موردنظر را انتخاب کنید') + ' — Esc: لغو'
        banner.style.cssText = 'position:fixed;bottom:18px;left:50%;transform:translateX(-50%);z-index:2147483647;background:#122b2a;color:white;border:1px solid #19a98e;border-radius:12px;padding:14px 24px;font:14px Tahoma;direction:rtl;pointer-events:none;box-shadow:0 8px 30px #0005;'
        document.documentElement.append(box, banner)
        const selectorFor = (element: Element, scope?: Element): string => {
          const segments: string[] = []
          let current: Element | null = element
          while (current && current !== scope) {
            if (!scope && current.id && document.querySelectorAll('#' + CSS.escape(current.id)).length === 1) {
              segments.unshift('#' + CSS.escape(current.id)); break
            }
            const tag = current.tagName.toLowerCase()
            const siblings: Element[] = current.parentElement ? Array.from(current.parentElement.children).filter(child => child.tagName === current!.tagName) : []
            segments.unshift(tag + (siblings.length > 1 ? ':nth-of-type(' + (siblings.indexOf(current) + 1) + ')' : ''))
            current = current.parentElement
          }
          return segments.join(' > ')
        }
        const targetFor = (event: MouseEvent): Element | null => {
          const target = event.target instanceof Element ? event.target : null
          if (!target) return null
          if (options.kind === 'rows') return target.closest('tr,[role="row"]') || target
          if (options.kind === 'column') return target.closest('td,th,[role="cell"]') || target
          return target
        }
        const move = (event: MouseEvent) => {
          const target = targetFor(event)
          if (!target) return
          const rect = target.getBoundingClientRect()
          Object.assign(box.style, { display: 'block', left: rect.left + 'px', top: rect.top + 'px', width: rect.width + 'px', height: rect.height + 'px' })
        }
        const cleanup = () => {
          clearTimeout(timer); box.remove(); banner.remove()
          document.removeEventListener('mousemove', move, true)
          document.removeEventListener('click', click, true)
          document.removeEventListener('keydown', key, true)
          delete (window as any).__automationCancelPick
        }
        const cancel = () => { cleanup(); resolve(null) }
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); cancel() } }
        const click = (event: MouseEvent) => {
          event.preventDefault(); event.stopImmediatePropagation()
          const element = targetFor(event)
          if (!element) return
          try {
            let selector: string
            let count: number
            if (options.kind === 'column') {
              const row = element.closest(options.rowSelector!)
              if (!row || row === element) { banner.textContent = 'یک سلول داخل ردیف‌های انتخاب‌شده را انتخاب کنید — Esc: لغو'; return }
              selector = selectorFor(element, row)
              count = row.querySelectorAll(selector).length
            } else if (options.kind === 'rows') {
              if (!element.parentElement) throw new Error('عنصر تکرارشونده را داخل صفحه انتخاب کنید.')
              if (element.tagName === 'TABLE') selector = selectorFor(element) + ' > tbody > tr'
              else {
                const classes = Array.from(element.classList).map(item => '.' + CSS.escape(item)).join('')
                selector = selectorFor(element.parentElement) + ' > ' + element.tagName.toLowerCase() + classes
              }
              count = document.querySelectorAll(selector).length
            } else {
              selector = selectorFor(element)
              count = document.querySelectorAll(selector).length
            }
            const text = (element.textContent || '').trim().slice(0, 180)
            cleanup(); resolve({ selector, count, text })
          } catch (error) { cleanup(); reject(error) }
        }
        const timer = setTimeout(cancel, 90000)
        ;(window as any).__automationCancelPick = cancel
        document.addEventListener('mousemove', move, true)
        document.addEventListener('click', click, true)
        document.addEventListener('keydown', key, true)
      }), request)
    })
  }
}
