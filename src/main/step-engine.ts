import type { Page, Locator } from 'playwright'
import type { Extraction, JsonValue, ScenarioStep, StepResult, ValueSource } from '../shared/types'
import { validateSteps } from '../shared/steps'

// Serialized into code scenarios too: no runtime references outside this function.
export async function executeSteps(firstPage: Page, steps: ScenarioStep[], input: JsonValue, publish: (result: StepResult) => Promise<void> = async () => {}, secrets: Record<string, string> = {}, shotPrefix?: string) {
  const output: Record<string, JsonValue> = {}
  // Tabs: index 0 is the first page; popups are appended. `page` always points at the active tab.
  const tabs: Page[] = firstPage.context().pages().filter(item => !item.isClosed())
  if (!tabs.includes(firstPage)) tabs.push(firstPage)
  let page: Page = firstPage
  const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))
  const resolve = (source: ValueSource): string => {
    if (source.kind === 'literal') return source.value
    if (source.kind === 'secret') {
      if (!Object.prototype.hasOwnProperty.call(secrets, source.value)) throw new Error('رمز ذخیره‌شده پیدا نشد: ' + source.value)
      return secrets[source.value]
    }
    let value: any = input
    for (const key of source.value.split('.')) {
      if (value === null || typeof value !== 'object' || !Object.prototype.hasOwnProperty.call(value, key)) throw new Error('ورودی پیدا نشد: input.' + source.value)
      value = value[key]
    }
    if (value === null || typeof value === 'object') throw new Error('ورودی باید متن، عدد یا مقدار بله/خیر باشد: input.' + source.value)
    return String(value)
  }
  const read = async (root: Page | Locator, config: Extraction): Promise<JsonValue> => {
    const locator = root.locator(config.selector)
    try { await locator.first().waitFor({ state: 'attached', timeout: config.missing === 'null' ? 1000 : 5000 }) }
    catch (error) { if (config.missing === 'null' && await locator.count() === 0) return null; throw error }
    const count = await locator.count()
    if (count !== 1) throw new Error('انتخابگر باید دقیقاً یک عنصر پیدا کند؛ تعداد فعلی: ' + count + ' (' + config.selector + ')')
    let raw: string | null
    if (config.read === 'value') raw = await locator.inputValue({ timeout: 5000 })
    else if (config.read === 'attribute') raw = await locator.getAttribute(config.attribute, { timeout: 5000 })
    else raw = await locator.innerText({ timeout: 5000 })
    return convert(raw, config)
  }
  const convert = (raw: string | null, config: Extraction): JsonValue => {
    if (raw === null) {
      if (config.missing === 'null') return null
      throw new Error('ویژگی موردنظر روی عنصر وجود ندارد: ' + config.attribute)
    }
    let value = raw.trim()
    if (config.normalizeDigits) value = value.replace(/[۰-۹]/g, digit => String(digit.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, digit => String(digit.charCodeAt(0) - 1632))
    if (config.dataType === 'text') return value
    if (config.dataType === 'number') {
      if (config.removeSeparators) value = value.replace(/[,٬\s\u200c]/g, '').replace(/٫/g, '.')
      if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(value) || !Number.isFinite(Number(value))) throw new Error('مقدار قابل تبدیل به عدد نیست: ' + raw.slice(0, 100))
      return Number(value)
    }
    const normalized = value.toLowerCase()
    if (['true', '1', 'yes', 'بله'].includes(normalized)) return true
    if (['false', '0', 'no', 'خیر'].includes(normalized)) return false
    throw new Error('مقدار قابل تبدیل به بله/خیر نیست: ' + raw.slice(0, 100))
  }
  page.setDefaultTimeout(10000)
  const runOnce = async (step: ScenarioStep): Promise<{ value: JsonValue; rowCount?: number }> => {
    let value: JsonValue = null
    let rowCount: number | undefined
    switch (step.type) {
      case 'navigate': {
        const url = resolve(step.url)
        if (!/^(https?:|file:|data:text\/html)/i.test(url)) throw new Error('آدرس باید HTTP، HTTPS یا یک صفحه محلی HTML باشد.')
        // A URL supplied by the API caller must not be able to open local files.
        if (step.url.kind === 'input' && !/^https?:/i.test(url)) throw new Error('آدرسی که از ورودی می‌آید باید HTTP یا HTTPS باشد.')
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 }); break
      }
      case 'fill': {
        const target = page.locator(step.selector)
        if (step.typing) await ((target as any).pressSequentially ?? (target as any).type).call(target, resolve(step.value), { delay: 30 })
        else await target.fill(resolve(step.value))
        break
      }
      case 'click': {
        const target = page.locator(step.selector)
        const act = () => step.double ? target.dblclick({ button: step.button ?? 'left' }) : target.click({ button: step.button ?? 'left' })
        if (step.opensTab) {
          const [popup] = await Promise.all([page.waitForEvent('popup', { timeout: 30000 }), act()])
          popup.setDefaultTimeout(10000)
          await popup.waitForLoadState('domcontentloaded', { timeout: 30000 }).catch(() => undefined)
          tabs.push(popup); page = popup
        } else await act()
        break
      }
      case 'tab': {
        if (step.action === 'close') {
          const closing = page
          const at = tabs.indexOf(closing)
          await closing.close()
          const open = tabs.filter(item => !item.isClosed())
          page = tabs.slice(0, at).reverse().find(item => !item.isClosed()) ?? open[open.length - 1] ?? closing
          if (page.isClosed()) break
        } else {
          const target = tabs[step.index]
          if (!target || target.isClosed()) throw new Error('تب شماره ' + (step.index + 1) + ' وجود ندارد یا بسته شده است.')
          page = target; await page.bringToFront().catch(() => undefined)
        }
        break
      }
      case 'dialog': {
        const accept = step.action === 'accept'
        page.once('dialog', dialog => { (accept ? dialog.accept() : dialog.dismiss()).catch(() => undefined) })
        break
      }
      case 'form':
        for (const field of step.fields) {
          const target = page.locator(field.selector)
          if (field.action === 'fill') await target.fill(resolve(field.value))
          else if (field.action === 'select') { const choice = resolve(field.value); await target.selectOption(field.by === 'label' ? { label: choice } : { value: choice }) }
          else await target.setChecked(field.action === 'check')
        }
        break
      case 'waitPage':
        if (step.mode === 'url') await page.waitForURL(step.url, { timeout: 30000 })
        else await page.waitForLoadState(step.mode, { timeout: 30000 })
        break
      case 'history':
        if (step.action === 'reload') await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 })
        else if (step.action === 'back') await page.goBack({ waitUntil: 'domcontentloaded', timeout: 30000 })
        else await page.goForward({ waitUntil: 'domcontentloaded', timeout: 30000 })
        break
      case 'code': {
        // Custom code written by the scenario author; it sees page, input, output and secrets only.
        const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor
        const returned = await new AsyncFunction('page', 'input', 'output', 'secrets', step.code)(page, input, output, secrets)
        if (returned !== undefined) {
          const data = JSON.parse(JSON.stringify(returned)) as JsonValue
          if (data && typeof data === 'object' && !Array.isArray(data)) Object.assign(output, data)
          else output.result = data
        }
        break
      }
      case 'pause': await sleep(Math.round(step.seconds * 1000)); break
      case 'hover': await page.locator(step.selector).hover(); break
      case 'select': {
        const choice = resolve(step.value)
        await page.locator(step.selector).selectOption(step.by === 'label' ? { label: choice } : { value: choice }); break
      }
      case 'check': await page.locator(step.selector).setChecked(step.checked); break
      case 'press':
        if (step.selector) await page.locator(step.selector).press(step.key)
        else await page.keyboard.press(step.key)
        break
      case 'scroll':
        if (step.to === 'element') await page.locator(step.selector).scrollIntoViewIfNeeded()
        else await page.evaluate(to => window.scrollTo({ top: to === 'top' ? 0 : document.documentElement.scrollHeight }), step.to)
        break
      case 'screenshot': if (shotPrefix) await page.screenshot({ path: shotPrefix + step.name + '.png', fullPage: step.fullPage, timeout: 15000 }); break
      case 'wait': await page.locator(step.selector).waitFor({ state: 'visible' }); break
      case 'field': value = await read(page, step.extraction); output[step.name] = value; break
      case 'table': {
        const rows = page.locator(step.rowSelector)
        try { await rows.first().waitFor({ state: 'attached', timeout: step.empty === 'allow' ? 1000 : 5000 }) }
        catch (error) {
          if (await rows.count() !== 0) throw error
          if (step.empty === 'error') throw new Error('هیچ ردیفی پیدا نشد؛ جدول خالی مجاز نیست.')
        }
        rowCount = await rows.count()
        if (rowCount === 0 && step.empty === 'error') throw new Error('هیچ ردیفی پیدا نشد؛ جدول خالی مجاز نیست.')
        if (rowCount > step.maxRows) throw new Error('تعداد ردیف‌ها ' + rowCount + ' است و از سقف ' + step.maxRows + ' بیشتر است؛ داده ناقص برگردانده نشد.')
        // One browser round trip for all rows. Columns whose selector is not plain CSS (or whose element cannot
        // be read this way) come back as `slow` and use the per-cell path, so behavior stays identical.
        const raws = await rows.evaluateAll((elements, columns) => elements.map(element => columns.map(column => {
          let found: Element[]
          try { found = Array.from(element.querySelectorAll(column.selector)) } catch { return { slow: true } }
          if (found.length !== 1) return { count: found.length }
          const node = found[0] as HTMLElement & { value?: string }
          if (column.read === 'value') {
            if (!['INPUT', 'TEXTAREA', 'SELECT'].includes(node.tagName)) return { slow: true }
            return { count: 1, raw: node.value as string }
          }
          if (column.read === 'attribute') return { count: 1, raw: node.getAttribute(column.attribute) }
          return { count: 1, raw: node.innerText }
        })), step.columns.map(column => ({ selector: column.selector, read: column.read, attribute: column.attribute })))
        const records: Record<string, JsonValue>[] = []
        for (let index = 0; index < raws.length; index++) {
          const record: Record<string, JsonValue> = {}
          for (let c = 0; c < step.columns.length; c++) {
            const column = step.columns[c]
            const cell = raws[index][c] as { slow?: boolean; count?: number; raw?: string | null }
            try {
              if (cell.slow) record[column.name] = await read(rows.nth(index), column)
              else if (cell.count === 0 && column.missing === 'null') record[column.name] = null
              else if (cell.count !== 1) throw new Error('انتخابگر باید دقیقاً یک عنصر پیدا کند؛ تعداد فعلی: ' + cell.count + ' (' + column.selector + ')')
              else record[column.name] = convert(cell.raw as string | null, column)
            } catch (error) { throw new Error('ردیف ' + (index + 1) + '، ستون ' + column.name + ': ' + (error as Error).message) }
          }
          records.push(record)
        }
        value = records; output[step.name] = value; break
      }
    }
    return { value, rowCount }
  }
  for (const step of steps) {
    const start = Date.now()
    const maxAttempts = (step.retries ?? 0) + 1
    let attempt = 0
    while (true) {
      attempt++
      await publish({ id: step.id, title: step.title, status: 'running', attempts: attempt })
      try {
        const { value, rowCount } = await runOnce(step)
        const sample = Array.isArray(value) ? value.slice(0, 20) : value
        await publish({ id: step.id, title: step.title, status: 'passed', durationMs: Date.now() - start, output: sample, rowCount, attempts: attempt })
        break
      } catch (error) {
        const message = (error as Error).message || String(error)
        if (attempt < maxAttempts) { await sleep(Math.round((step.retryDelaySec ?? 1) * 1000)); continue }
        await publish({ id: step.id, title: step.title, status: 'failed', durationMs: Date.now() - start, error: message, attempts: attempt, continued: step.continueOnError === true })
        if (step.continueOnError) {
          if (step.type === 'field' || step.type === 'table') output[step.name] = null
          break
        }
        throw Object.assign(new Error(step.title + ': ' + message), { stepId: step.id })
      }
    }
  }
  return output
}

export function compileSteps(steps: ScenarioStep[]): string {
  validateSteps(steps)
  const source = executeSteps.toString()
  // Bundler helpers live outside the function and would be undefined inside the scenario worker.
  if (/\b__name\(|\b__publicField\(|\b__async\(|\b__spreadValues\(/.test(source)) throw new Error('Step engine was bundled with external helpers; it cannot be serialized into a scenario.')
  return 'return await (' + source + ')(page, ' + JSON.stringify(steps) + ', input, async (step) => { if (process.send) await new Promise(resolve => process.send({ type: "step", step }, () => resolve())); }, secrets, "shot-");'
}
