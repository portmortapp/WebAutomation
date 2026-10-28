import type { Extraction, ScenarioStep, ValueSource } from './types'
import { ValidationError } from './validation'

export const stepLabels: Record<ScenarioStep['type'], string> = {
  navigate: 'بازکردن صفحه', fill: 'واردکردن مقدار', click: 'کلیک', wait: 'انتظار برای عنصر', pause: 'ماندن در صفحه', hover: 'قراردادن ماوس روی عنصر', select: 'انتخاب از لیست', check: 'تیک زدن / برداشتن تیک', press: 'فشردن کلید', scroll: 'اسکرول', screenshot: 'اسکرین‌شات', form: 'پر کردن فرم (چند فیلد)', tab: 'تعویض یا بستن تب', dialog: 'پاسخ به پیام (دیالوگ)', waitPage: 'انتظار برای صفحه', history: 'بارگذاری مجدد / برگشت', code: 'کد سفارشی', field: 'خواندن مقدار', table: 'استخراج جدول'
}
export const defaultExtraction = (): Extraction => ({ selector: '', read: 'text', attribute: 'href', dataType: 'text', normalizeDigits: true, removeSeparators: true, missing: 'error' })
export function createStep(type: ScenarioStep['type']): ScenarioStep {
  const base = { id: crypto.randomUUID(), title: stepLabels[type] }
  switch (type) {
    case 'navigate': return { ...base, type, url: { kind: 'literal', value: 'https://example.com' } }
    case 'fill': return { ...base, type, selector: '', value: { kind: 'input', value: 'orderId' } }
    case 'pause': return { ...base, type, seconds: 5 }
    case 'hover': return { ...base, type, selector: '' }
    case 'select': return { ...base, type, selector: '', value: { kind: 'literal', value: '' }, by: 'value' }
    case 'check': return { ...base, type, selector: '', checked: true }
    case 'press': return { ...base, type, selector: '', key: 'Enter' }
    case 'scroll': return { ...base, type, to: 'bottom', selector: '' }
    case 'screenshot': return { ...base, type, name: 'page', fullPage: false }
    case 'click': case 'wait': return { ...base, type, selector: '' }
    case 'form': return { ...base, type, fields: [{ id: crypto.randomUUID(), selector: '', action: 'fill', value: { kind: 'input', value: 'name' } }] }
    case 'waitPage': return { ...base, type, mode: 'load', url: '' }
    case 'tab': return { ...base, type, action: 'switch', index: 0 }
    case 'dialog': return { ...base, type, action: 'accept' }
    case 'history': return { ...base, type, action: 'reload' }
    case 'code': return { ...base, type, code: "// متغیرهای در دسترس: page، input، output، secrets\nawait page.waitForTimeout(500)" }
    case 'field': return { ...base, type, name: 'field', extraction: defaultExtraction() }
    case 'table': return { ...base, type, name: 'items', rowSelector: '', empty: 'error', maxRows: 1000, columns: [{ ...defaultExtraction(), id: crypto.randomUUID(), name: 'title', selector: 'td:nth-of-type(1)' }] }
  }
}

export const secretNamePattern = /^[a-zA-Z0-9_-]{1,60}$/
const allowedKeys = /^(?:(?:Control|Shift|Alt|Meta)\+)*(?:[A-Za-z0-9]|F(?:[1-9]|1[0-2])|Enter|Tab|Escape|Backspace|Delete|Space|Home|End|PageUp|PageDown|Arrow(?:Up|Down|Left|Right))$/
const text = (value: unknown, label: string) => {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new ValidationError(label + ' را وارد کنید (حداکثر ۴۰۰۰ کاراکتر).')
}
const name = (value: unknown) => {
  if (typeof value !== 'string' || !/^[a-zA-Z_][a-zA-Z0-9_]{0,79}$/.test(value) || ['__proto__', 'constructor', 'prototype'].includes(value)) throw new ValidationError('نام خروجی باید انگلیسی، بدون فاصله و با حرف یا زیرخط شروع شود.')
}
const source = (value: ValueSource) => {
  if (!value || !['literal', 'input', 'secret'].includes(value.kind) || typeof value.value !== 'string') throw new ValidationError('منبع مقدار نامعتبر است.')
  if (value.kind === 'secret' && !secretNamePattern.test(value.value)) throw new ValidationError('نام رمز نامعتبر است؛ فقط حروف انگلیسی، عدد، _ و - تا ۶۰ کاراکتر.')
  if (value.kind === 'input' && !/^[a-zA-Z_][\w]*(\.[a-zA-Z_][\w]*|\.\d+)*$/.test(value.value)) throw new ValidationError('مسیر ورودی نامعتبر است؛ مثلاً order.id')
}
const extraction = (value: Extraction) => {
  if (!value) throw new ValidationError('تنظیمات استخراج را وارد کنید.')
  text(value.selector, 'انتخابگر عنصر')
  if (!['text', 'value', 'attribute'].includes(value.read) || !['text', 'number', 'boolean'].includes(value.dataType) || !['error', 'null'].includes(value.missing)) throw new ValidationError('تنظیمات استخراج نامعتبر است.')
  if (value.read === 'attribute') text(value.attribute, 'نام ویژگی')
  if (typeof value.normalizeDigits !== 'boolean' || typeof value.removeSeparators !== 'boolean') throw new ValidationError('تنظیمات تبدیل مقدار نامعتبر است.')
}

export function validateSteps(value: unknown): asserts value is ScenarioStep[] {
  if (!Array.isArray(value) || !value.length || value.length > 100) throw new ValidationError('سناریو باید بین ۱ تا ۱۰۰ مرحله داشته باشد.')
  const ids = new Set<string>(), names = new Set<string>(), shots = new Set<string>()
  for (const step of value as ScenarioStep[]) {
    if (!step || typeof step !== 'object') throw new ValidationError('مرحله نامعتبر است.')
    text(step.id, 'شناسه مرحله'); text(step.title, 'عنوان مرحله')
    if (step.retries !== undefined && (!Number.isInteger(step.retries) || step.retries < 0 || step.retries > 5)) throw new ValidationError('تعداد تلاش مجدد باید بین ۰ تا ۵ باشد.')
    if (step.retryDelaySec !== undefined && (typeof step.retryDelaySec !== 'number' || !Number.isFinite(step.retryDelaySec) || step.retryDelaySec < 0 || step.retryDelaySec > 60)) throw new ValidationError('فاصله تلاش مجدد باید بین ۰ تا ۶۰ ثانیه باشد.')
    if (step.continueOnError !== undefined && typeof step.continueOnError !== 'boolean') throw new ValidationError('تنظیم ادامه پس از خطا نامعتبر است.')
    if (ids.has(step.id)) throw new ValidationError('شناسه مرحله تکراری است.')
    ids.add(step.id)
    switch (step.type) {
      case 'navigate': source(step.url); text(step.url.value, 'آدرس صفحه'); break
      case 'fill': source(step.value); text(step.selector, 'انتخابگر'); if (step.typing !== undefined && typeof step.typing !== 'boolean') throw new ValidationError('تنظیم تایپ نامعتبر است.'); break
      case 'click':
        text(step.selector, 'انتخابگر')
        if (step.button !== undefined && !['left', 'right', 'middle'].includes(step.button)) throw new ValidationError('دکمهٔ ماوس نامعتبر است.')
        if (step.double !== undefined && typeof step.double !== 'boolean') throw new ValidationError('تنظیم دوبار کلیک نامعتبر است.')
        if (step.opensTab !== undefined && typeof step.opensTab !== 'boolean') throw new ValidationError('تنظیم باز شدن تب جدید نامعتبر است.')
        break
      case 'wait': text(step.selector, 'انتخابگر'); break
      case 'form': {
        if (!Array.isArray(step.fields) || !step.fields.length || step.fields.length > 60) throw new ValidationError('بین ۱ تا ۶۰ فیلد برای فرم تعریف کنید.')
        const fieldIds = new Set<string>()
        for (const field of step.fields) {
          if (!field || !['fill', 'select', 'check', 'uncheck'].includes(field.action)) throw new ValidationError('نوع فیلد فرم نامعتبر است.')
          text(field.id, 'شناسه فیلد'); text(field.selector, 'انتخابگر فیلد'); source(field.value)
          if (field.action === 'select' && field.by !== undefined && !['value', 'label'].includes(field.by)) throw new ValidationError('روش انتخاب از لیست نامعتبر است.')
          if (fieldIds.has(field.id)) throw new ValidationError('شناسه فیلد تکراری است.')
          fieldIds.add(field.id)
        }
        break
      }
      case 'waitPage':
        if (!['load', 'domcontentloaded', 'networkidle', 'url'].includes(step.mode)) throw new ValidationError('نوع انتظار برای صفحه نامعتبر است.')
        if (step.mode === 'url') text(step.url, 'آدرس یا الگوی آدرس')
        break
      case 'tab':
        if (!['switch', 'close'].includes(step.action) || !Number.isInteger(step.index) || step.index < 0 || step.index > 30) throw new ValidationError('تنظیم تب نامعتبر است؛ شماره تب بین ۱ تا ۳۱ است.')
        break
      case 'dialog': if (!['accept', 'dismiss'].includes(step.action)) throw new ValidationError('پاسخ دیالوگ نامعتبر است.'); break
      case 'history': if (!['reload', 'back', 'forward'].includes(step.action)) throw new ValidationError('عمل تاریخچه نامعتبر است.'); break
      case 'code':
        if (typeof step.code !== 'string' || !step.code.trim() || step.code.length > 20000) throw new ValidationError('کد سفارشی را وارد کنید (حداکثر ۲۰۰۰۰ کاراکتر).')
        break
      case 'hover': text(step.selector, 'انتخابگر'); break
      case 'select':
        source(step.value); text(step.selector, 'انتخابگر')
        if (!['value', 'label'].includes(step.by)) throw new ValidationError('روش انتخاب از لیست نامعتبر است.')
        break
      case 'check': text(step.selector, 'انتخابگر'); if (typeof step.checked !== 'boolean') throw new ValidationError('وضعیت تیک نامعتبر است.'); break
      case 'press':
        if (step.selector !== '' ) text(step.selector, 'انتخابگر')
        if (typeof step.key !== 'string' || !allowedKeys.test(step.key)) throw new ValidationError('کلید نامعتبر است؛ مثلاً Enter، Tab، Escape، ArrowDown یا Control+A.')
        break
      case 'scroll':
        if (!['top', 'bottom', 'element'].includes(step.to)) throw new ValidationError('مقصد اسکرول نامعتبر است.')
        if (step.to === 'element') text(step.selector, 'انتخابگر')
        break
      case 'screenshot':
        if (typeof step.name !== 'string' || !/^[a-zA-Z0-9_-]{1,60}$/.test(step.name)) throw new ValidationError('نام اسکرین‌شات باید انگلیسی، بدون فاصله و حداکثر ۶۰ کاراکتر باشد.')
        if (typeof step.fullPage !== 'boolean') throw new ValidationError('تنظیم اسکرین‌شات نامعتبر است.')
        if (shots.has(step.name)) throw new ValidationError('نام اسکرین‌شات‌ها باید یکتا باشد: ' + step.name)
        shots.add(step.name)
        break
      case 'pause':
        if (typeof step.seconds !== 'number' || !Number.isFinite(step.seconds) || step.seconds < 0.1 || step.seconds > 3600) throw new ValidationError('مدت ماندن در صفحه باید بین ۰٫۱ تا ۳۶۰۰ ثانیه باشد.')
        break
      case 'field': name(step.name); extraction(step.extraction); break
      case 'table': {
        name(step.name); text(step.rowSelector, 'انتخابگر ردیف‌ها')
        if (!['error', 'allow'].includes(step.empty) || !Number.isInteger(step.maxRows) || step.maxRows < 1 || step.maxRows > 10000) throw new ValidationError('تنظیمات جدول نامعتبر است؛ سقف ردیف بین ۱ تا ۱۰۰۰۰ است.')
        if (!Array.isArray(step.columns) || !step.columns.length || step.columns.length > 50) throw new ValidationError('بین ۱ تا ۵۰ ستون تعریف کنید.')
        const columns = new Set<string>(), columnIds = new Set<string>()
        for (const column of step.columns) {
          if (!column) throw new ValidationError('ستون نامعتبر است.')
          name(column.name); text(column.id, 'شناسه ستون'); extraction(column)
          if (columns.has(column.name) || columnIds.has(column.id)) throw new ValidationError('نام یا شناسه ستون تکراری است.')
          columns.add(column.name); columnIds.add(column.id)
        }
        break
      }
      default: throw new ValidationError('نوع مرحله پشتیبانی نمی‌شود.')
    }
    if (step.type === 'field' || step.type === 'table') {
      if (names.has(step.name)) throw new ValidationError('نام خروجی مراحل باید یکتا باشد: ' + step.name)
      names.add(step.name)
    }
  }
}
