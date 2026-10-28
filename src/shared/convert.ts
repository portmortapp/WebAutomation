import type { FormField, ScenarioStep, ValueSource } from './types'
import { createStep, validateSteps } from './steps'

// Two-way conversion between recorded/handwritten Playwright code and visual steps.
// Plain statements become dedicated nodes; anything else becomes a «کد سفارشی» node that runs the original code unchanged,
// so a conversion never loses or invents behavior.

export interface ConvertResult { steps: ScenarioStep[]; skipped: string[]; exact: boolean; custom: number }

type Literal = string | number | boolean | null | { regex: string; flags: string } | { input: string } | { secret: string } | Literal[] | { [key: string]: Literal }
type Call = { name: string; args: Literal[] | null }

class Reader {
  pos = 0
  constructor(readonly src: string) {}
  ws() { while (this.pos < this.src.length && /\s/.test(this.src[this.pos])) this.pos++ }
  peek() { this.ws(); return this.src[this.pos] }
  eat(ch: string) { this.ws(); if (this.src[this.pos] !== ch) throw new Error('expected ' + ch); this.pos++ }
  ident() {
    this.ws()
    const match = /^[A-Za-z_$][\w$]*/.exec(this.src.slice(this.pos))
    if (!match) throw new Error('expected identifier')
    this.pos += match[0].length
    return match[0]
  }
  string(): string {
    this.ws()
    const quote = this.src[this.pos++]
    let out = ''
    while (this.pos < this.src.length && this.src[this.pos] !== quote) {
      let ch = this.src[this.pos++]
      if (ch === '\\') {
        const next = this.src[this.pos++]
        const map: Record<string, string> = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', '0': '\0' }
        if (next === 'u') { out += String.fromCharCode(parseInt(this.src.slice(this.pos, this.pos + 4), 16)); this.pos += 4; continue }
        if (next === 'x') { out += String.fromCharCode(parseInt(this.src.slice(this.pos, this.pos + 2), 16)); this.pos += 2; continue }
        ch = map[next] ?? next
      } else if (quote === '`' && ch === '$' && this.src[this.pos] === '{') throw new Error('template expressions are not supported')
      out += ch
    }
    if (this.src[this.pos] !== quote) throw new Error('unterminated string')
    this.pos++
    return out
  }
  value(): Literal {
    const ch = this.peek()
    if (ch === "'" || ch === '"' || ch === '`') return this.string()
    if (ch === '/') {
      this.pos++
      let source = ''
      while (this.pos < this.src.length && this.src[this.pos] !== '/') { if (this.src[this.pos] === '\\') source += this.src[this.pos++]; source += this.src[this.pos++] }
      this.pos++
      const flags = /^[a-z]*/.exec(this.src.slice(this.pos))![0]
      this.pos += flags.length
      return { regex: source, flags }
    }
    if (ch === '[') {
      this.pos++
      const items: Literal[] = []
      while (this.peek() !== ']') { items.push(this.value()); if (this.peek() === ',') this.pos++ }
      this.pos++
      return items
    }
    if (ch === '{') {
      this.pos++
      const object: { [key: string]: Literal } = {}
      while (this.peek() !== '}') {
        const key = /['"`]/.test(this.peek()) ? this.string() : this.ident()
        this.eat(':')
        object[key] = this.value()
        if (this.peek() === ',') this.pos++
      }
      this.pos++
      return object
    }
    const rest = this.src.slice(this.pos)
    const inputRef = /^input((?:\??\.[A-Za-z_]\w*|\?\.\[(?:"[^"]*"|'[^']*'|\d+)\]|\[(?:"[^"]*"|'[^']*'|\d+)\])+)/.exec(rest)
    if (inputRef) {
      const path = [...inputRef[1].matchAll(/\??\.([A-Za-z_]\w*)|\[(?:"([^"]*)"|'([^']*)'|(\d+))\]/g)].map(m => m[1] ?? m[2] ?? m[3] ?? m[4])
      this.pos += inputRef[0].length
      return { input: path.join('.') }
    }
    const secretRef = /^secrets(?:\[(?:"([^"]*)"|'([^']*)')\]|\.([A-Za-z_]\w*))/.exec(rest)
    if (secretRef) { this.pos += secretRef[0].length; return { secret: secretRef[1] ?? secretRef[2] ?? secretRef[3] } }
    const word = /^(?:-?\d+(?:\.\d+)?|true|false|null)\b/.exec(this.src.slice(this.pos))
    if (!word) throw new Error('unsupported value')
    this.pos += word[0].length
    return word[0] === 'true' ? true : word[0] === 'false' ? false : word[0] === 'null' ? null : Number(word[0])
  }
  args(): Literal[] {
    this.eat('(')
    const items: Literal[] = []
    while (this.peek() !== ')') { items.push(this.value()); if (this.peek() === ',') this.pos++ }
    this.pos++
    return items
  }
}

const TAB_VAR = /^[A-Za-z_$][\w$]*$/

function parseChain(statement: string, roots: Set<string>): { root: string; calls: Call[] } {
  const reader = new Reader(statement.replace(/^await\s+/, '').replace(/;\s*$/, ''))
  const root = reader.ident()
  if (!roots.has(root)) throw new Error('not a page statement')
  const calls: Call[] = []
  while (reader.peek() === '.') {
    reader.pos++
    const name = reader.ident()
    calls.push({ name, args: reader.peek() === '(' ? reader.args() : null })
  }
  reader.ws()
  if (reader.pos < reader.src.length) throw new Error('unsupported trailing code')
  return { root, calls }
}

const quoted = (text: string) => '"' + text.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"'
const matcher = (value: Literal, exact: boolean): string => typeof value === 'object' && value && !Array.isArray(value) && 'regex' in value
  ? '/' + value.regex + '/' + value.flags
  : quoted(String(value)) + (exact ? 's' : 'i')
const isObject = (value: Literal | undefined): value is { [key: string]: Literal } => !!value && typeof value === 'object' && !Array.isArray(value) && !('regex' in value) && !('input' in value) && !('secret' in value)
const asSource = (value: Literal | undefined): ValueSource => {
  if (typeof value === 'string') return { kind: 'literal', value }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'input' in value) return { kind: 'input', value: String(value.input) }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'secret' in value) return { kind: 'secret', value: String(value.secret) }
  throw new Error('unsupported value')
}
const asString = (value: Literal | undefined): string => { if (typeof value !== 'string') throw new Error('expected text'); return value }
const options = (value: Literal | undefined): { [key: string]: Literal } => isObject(value) ? value : {}
// Options that change behavior make the statement unrepresentable as a plain node (it then becomes a code node).
const only = (value: Literal | undefined, allowed: string[]): { [key: string]: Literal } => {
  if (value === undefined) return {}
  if (!isObject(value)) throw new Error('unsupported options')
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw new Error('unsupported option ' + key)
  return value
}

// Builds a Playwright selector string equal to the recorded locator chain.
function selectorOf(calls: Call[]): { selector: string; rest: Call[] } {
  const parts: string[] = []
  let index = 0
  for (; index < calls.length; index++) {
    const { name, args } = calls[index]
    const a = args ?? []
    const opts = options(a[1])
    const exact = opts.exact === true
    let part: string
    switch (name) {
      case 'locator': part = asString(a[0]); if (a[1] !== undefined) throw new Error('locator options'); break
      case 'frameLocator': part = asString(a[0]) + ' >> internal:control=enter-frame'; break
      case 'contentFrame': if (!parts.length) throw new Error('modifier without locator'); part = 'internal:control=enter-frame'; break
      case 'getByRole': {
        part = 'internal:role=' + asString(a[0])
        if (opts.name !== undefined) part += '[name=' + matcher(opts.name, exact) + ']'
        for (const key of ['checked', 'disabled', 'expanded', 'pressed', 'selected', 'level', 'includeHidden']) if (opts[key] !== undefined) part += '[' + key + '=' + String(opts[key]) + ']'
        break
      }
      case 'getByText': part = 'internal:text=' + matcher(a[0] as Literal, exact); break
      case 'getByLabel': part = 'internal:label=' + matcher(a[0] as Literal, exact); break
      case 'getByPlaceholder': part = 'internal:attr=[placeholder=' + matcher(a[0] as Literal, exact) + ']'; break
      case 'getByAltText': part = 'internal:attr=[alt=' + matcher(a[0] as Literal, exact) + ']'; break
      case 'getByTitle': part = 'internal:attr=[title=' + matcher(a[0] as Literal, exact) + ']'; break
      case 'getByTestId': part = 'internal:testid=[data-testid=' + quoted(asString(a[0])) + 's]'; break
      case 'first': part = 'nth=0'; break
      case 'last': part = 'nth=-1'; break
      case 'nth': if (typeof a[0] !== 'number') throw new Error('nth needs a number'); part = 'nth=' + a[0]; break
      case 'filter': {
        const f = options(a[0])
        if (f.hasText === undefined || Object.keys(f).length !== 1) throw new Error('unsupported filter')
        part = 'internal:has-text=' + matcher(f.hasText, false); break
      }
      default: return { selector: parts.join(' >> '), rest: calls.slice(index) }
    }
    if (!parts.length && ['first', 'last', 'nth', 'filter'].includes(name)) throw new Error('modifier without locator')
    parts.push(part)
  }
  return { selector: parts.join(' >> '), rest: [] }
}

const short = (text: string) => text.length > 38 ? text.slice(0, 35) + '…' : text
const describe = (selector: string) => {
  const named = /name="([^"]+)"/.exec(selector) ?? /(?:text|label|placeholder|alt|title|testid)=(?:\[[\w-]+=)?"([^"]+)"/.exec(selector) ?? /^#[\w-]+|^\.[\w-]+/.exec(selector)
  return named ? short((named[1] ?? named[0]).trim()) : short(selector)
}

// A single `page.xxx(...)` statement -> one node. Returns null for harmless no-ops; throws when it needs the code node.
function statementToStep(statement: string, roots: Set<string>): { step: ScenarioStep | null; root: string } {
  const { root, calls } = parseChain(statement, roots)
  if (!calls.length) throw new Error('empty')
  const first = calls[0]
  const base = (type: ScenarioStep['type'], title: string) => ({ ...createStep(type), title })
  const done = (step: ScenarioStep | null) => ({ step, root })
  if (first.name === 'bringToFront' && calls.length === 1) return done(null)
  if (first.name === 'goto') {
    if (calls.length !== 1) throw new Error('goto with chained calls')
    only(first.args?.[1], ['waitUntil', 'timeout'])
    const url = asSource(first.args?.[0])
    const step = createStep('navigate')
    if (step.type === 'navigate') step.url = url
    return done({ ...step, title: 'بازکردن صفحه — ' + short(url.kind === 'literal' ? url.value : url.kind === 'input' ? 'input.' + url.value : 'رمز ' + url.value) })
  }
  if (first.name === 'waitForTimeout') {
    const ms = first.args?.[0]
    if (calls.length !== 1 || typeof ms !== 'number' || ms < 100 || ms > 3_600_000) throw new Error('unsupported wait')
    return done({ ...base('pause', 'ماندن در صفحه'), type: 'pause', seconds: ms / 1000 } as ScenarioStep)
  }
  if (first.name === 'waitForURL') {
    const url = first.args?.[0]
    if (calls.length !== 1 || typeof url !== 'string') throw new Error('unsupported waitForURL')
    only(first.args?.[1], ['timeout', 'waitUntil'])
    return done({ ...base('waitPage', 'انتظار برای آدرس — ' + short(url)), type: 'waitPage', mode: 'url', url } as ScenarioStep)
  }
  if (first.name === 'waitForLoadState') {
    const state = first.args?.[0] ?? 'load'
    if (calls.length !== 1 || (state !== 'load' && state !== 'domcontentloaded' && state !== 'networkidle')) throw new Error('unsupported waitForLoadState')
    only(first.args?.[1], ['timeout'])
    return done({ ...base('waitPage', 'انتظار برای بارگذاری صفحه'), type: 'waitPage', mode: state, url: '' } as ScenarioStep)
  }
  if (['reload', 'goBack', 'goForward'].includes(first.name)) {
    if (calls.length !== 1) throw new Error('chained history call')
    only(first.args?.[0], ['waitUntil', 'timeout'])
    const action = first.name === 'reload' ? 'reload' : first.name === 'goBack' ? 'back' : 'forward'
    return done({ ...base('history', action === 'reload' ? 'بارگذاری مجدد صفحه' : action === 'back' ? 'بازگشت به صفحهٔ قبل' : 'رفتن به صفحهٔ بعد'), type: 'history', action } as ScenarioStep)
  }
  if (first.name === 'waitForSelector') {
    const selector = first.args?.[0]
    const o = only(first.args?.[1], ['state', 'timeout'])
    if (calls.length !== 1 || typeof selector !== 'string' || (o.state !== undefined && o.state !== 'visible')) throw new Error('unsupported waitForSelector')
    return done({ ...base('wait', 'انتظار برای — ' + describe(selector)), type: 'wait', selector } as ScenarioStep)
  }
  if (first.name === 'keyboard') {
    const press = calls[1]
    if (calls.length !== 2 || press?.name !== 'press' || typeof press.args?.[0] !== 'string') throw new Error('unsupported keyboard call')
    only(press.args?.[1], ['delay'])
    return done({ ...base('press', 'فشردن کلید ' + press.args[0]), type: 'press', selector: '', key: press.args[0] } as ScenarioStep)
  }
  const { selector, rest } = selectorOf(calls)
  if (!selector || rest.length !== 1) throw new Error('unsupported statement')
  const action = rest[0]
  const a = action.args ?? []
  const arg = a[0]
  const label = describe(selector)
  switch (action.name) {
    case 'click': case 'dblclick': {
      const o = only(a[0], action.name === 'click' ? ['button', 'clickCount', 'timeout', 'delay'] : ['button', 'timeout', 'delay'])
      const button = o.button === undefined ? undefined : o.button
      if (button !== undefined && button !== 'left' && button !== 'right' && button !== 'middle') throw new Error('unsupported button')
      if (o.clickCount !== undefined && o.clickCount !== 1 && o.clickCount !== 2) throw new Error('unsupported clickCount')
      const double = action.name === 'dblclick' || o.clickCount === 2
      const step = { ...base('click', (double ? 'دوبار کلیک — ' : button === 'right' ? 'کلیک راست — ' : 'کلیک — ') + label), type: 'click', selector } as ScenarioStep & { type: 'click' }
      if (button && button !== 'left') step.button = button
      if (double) step.double = true
      return done(step)
    }
    case 'hover': only(a[0], ['timeout']); return done({ ...base('hover', 'ماوس روی — ' + label), type: 'hover', selector } as ScenarioStep)
    case 'waitFor': { const o = only(a[0], ['state', 'timeout']); if (o.state !== undefined && o.state !== 'visible') throw new Error('unsupported state'); return done({ ...base('wait', 'انتظار برای — ' + label), type: 'wait', selector } as ScenarioStep) }
    case 'fill': only(a[1], ['timeout']); return done({ ...base('fill', 'واردکردن — ' + label), type: 'fill', selector, value: asSource(arg) } as ScenarioStep)
    case 'clear': only(a[0], ['timeout']); return done({ ...base('fill', 'پاک‌کردن — ' + label), type: 'fill', selector, value: { kind: 'literal', value: '' } } as ScenarioStep)
    case 'type': case 'pressSequentially': only(a[1], ['timeout', 'delay']); return done({ ...base('fill', 'تایپ کردن — ' + label), type: 'fill', selector, value: asSource(arg), typing: true } as ScenarioStep)
    case 'press': {
      if (typeof arg !== 'string') throw new Error('press needs a key')
      only(a[1], ['timeout', 'delay'])
      return done({ ...base('press', 'فشردن ' + arg + ' — ' + label), type: 'press', selector, key: arg } as ScenarioStep)
    }
    case 'check': case 'uncheck': only(a[0], ['timeout']); return done({ ...base('check', (action.name === 'check' ? 'تیک زدن — ' : 'برداشتن تیک — ') + label), type: 'check', selector, checked: action.name === 'check' } as ScenarioStep)
    case 'setChecked': only(a[1], ['timeout']); if (typeof arg !== 'boolean') throw new Error('setChecked needs a boolean'); return done({ ...base('check', 'تیک — ' + label), type: 'check', selector, checked: arg } as ScenarioStep)
    case 'scrollIntoViewIfNeeded': only(a[0], ['timeout']); return done({ ...base('scroll', 'اسکرول تا — ' + label), type: 'scroll', to: 'element', selector } as ScenarioStep)
    case 'selectOption': {
      only(a[1], ['timeout'])
      const option = Array.isArray(arg) ? (arg.length === 1 ? arg[0] : (() => { throw new Error('multiple options') })()) : arg
      let value: ValueSource, by: 'value' | 'label' = 'value'
      const o = options(option)
      if (typeof option === 'string' || (option && typeof option === 'object' && ('input' in option || 'secret' in option))) value = asSource(option)
      else if (o.label !== undefined && Object.keys(o).length === 1) { value = asSource(o.label); by = 'label' } else if (o.value !== undefined && Object.keys(o).length === 1) value = asSource(o.value); else throw new Error('unsupported option')
      return done({ ...base('select', 'انتخاب از لیست — ' + label), type: 'select', selector, value, by } as ScenarioStep)
    }
    default: throw new Error('unsupported action ' + action.name)
  }
}

// ---------- statement splitting ----------
interface Piece { kind: 'comment' | 'stmt'; text: string }

function splitStatements(src: string): Piece[] {
  const pieces: Piece[] = []
  let cur = ''
  let depth = 0
  let i = 0
  const n = src.length
  const flush = () => { const text = cur.trim(); if (text) pieces.push({ kind: 'stmt', text }); cur = '' }
  const lastSignificant = () => { const t = cur.trimEnd(); return t[t.length - 1] ?? '' }
  const continuation = (rest: string) => /^(?:\.|\?\.|&&|\|\||\?\?|\?|:|\+|\*|\/(?![/*])|,|\)|\]|else\b|catch\b|finally\b|while\b)/.test(rest)
  while (i < n) {
    const ch = src[i]
    if (ch === '/' && src[i + 1] === '/') {
      let end = src.indexOf('\n', i); if (end < 0) end = n
      if (depth === 0 && !cur.trim()) pieces.push({ kind: 'comment', text: src.slice(i + 2, end).trim() })
      i = end; continue
    }
    if (ch === '/' && src[i + 1] === '*') { const end = src.indexOf('*/', i + 2); i = end < 0 ? n : end + 2; continue }
    if (ch === '"' || ch === "'") {
      let j = i + 1
      while (j < n && src[j] !== ch) { if (src[j] === '\\') j++; j++ }
      cur += src.slice(i, j + 1); i = j + 1; continue
    }
    if (ch === '`') {
      let j = i + 1, nest = 0
      while (j < n && !(src[j] === '`' && nest === 0)) {
        if (src[j] === '\\') { j += 2; continue }
        if (src[j] === '$' && src[j + 1] === '{') { nest++; j += 2; continue }
        if (nest > 0 && src[j] === '}') nest--
        j++
      }
      cur += src.slice(i, j + 1); i = j + 1; continue
    }
    if (ch === '/' && (!cur.trim() || /[(,=:[!&|?{};]$/.test(cur.trimEnd()) || /\breturn$/.test(cur.trimEnd()))) {
      let j = i + 1, inClass = false
      while (j < n && (src[j] !== '/' || inClass) && src[j] !== '\n') { if (src[j] === '\\') j++; else if (src[j] === '[') inClass = true; else if (src[j] === ']') inClass = false; j++ }
      if (src[j] === '/') { j++; while (/[a-z]/.test(src[j] ?? '')) j++; cur += src.slice(i, j); i = j; continue }
    }
    if (ch === '(' || ch === '[' || ch === '{') depth++
    if (ch === ')' || ch === ']' || ch === '}') depth--
    if (ch === '\n' && depth <= 0) {
      const body = cur.trim()
      if (!body) { cur = ''; i++; continue }
      const rest = src.slice(i + 1).trimStart()
      const last = lastSignificant()
      const pending = /[+\-*/%&|^=,?:.<>!(]$/.test(last) || /^(?:if|for|while)\b[^{]*\)$/.test(body) || /^(?:else|do)$/.test(body) || /^(?:const|let|var)\s+[\w$]+$/.test(body)
      if (pending || continuation(rest)) { cur += ch; i++; continue }
      flush(); i++; continue
    }
    cur += ch
    i++
    if (ch === ';' && depth <= 0) flush()
    else if (ch === '}' && depth <= 0) {
      const rest = src.slice(i).trimStart()
      if (!continuation(rest) && !/^(?:[;,)]|=(?!=)|\(|from\b)/.test(rest)) flush()
    }
  }
  flush()
  return pieces
}

const WRAPPER = /^(?:return\s+)?(?:await\s+)?\(\s*async\s*(?:function\s*)?\(\s*\)\s*(?:=>)?\s*\{([\s\S]*)\}\s*\)\s*\(\s*\)\s*(?:\.\w+\([\s\S]*\))?\s*;?$/
const TEST_WRAPPER = /^(?:test|it)(?:\.\w+)?\(\s*(?:'[^']*'|"[^"]*"|`[^`]*`)\s*,\s*async\s*\(\s*\{[^}]*\}\s*\)\s*=>\s*\{([\s\S]*)\}\s*\)\s*;?$/
const MAIN_FN = /^async\s+function\s+\w+\s*\(\s*\)\s*\{([\s\S]*)\}$/

function flatten(src: string, depth = 0): Piece[] {
  const out: Piece[] = []
  for (const piece of splitStatements(src)) {
    const inner = piece.kind === 'stmt' && depth < 4 ? (WRAPPER.exec(piece.text) ?? TEST_WRAPPER.exec(piece.text))?.[1] : undefined
    if (inner !== undefined) out.push(...flatten(inner, depth + 1))
    else out.push(piece)
  }
  return out
}

// ---------- tab bookkeeping shared by both conversion directions ----------
class Tabs {
  vars = new Map<string, number>([['page', 0]])
  count = 1
  cur = 0
  closed = new Set<number>()
  open(name?: string) { const index = this.count++; if (name) this.vars.set(name, index); this.cur = index; return index }
  close(index: number) {
    this.closed.add(index)
    if (this.cur !== index) return
    let next = -1
    for (let k = index - 1; k >= 0; k--) if (!this.closed.has(k)) { next = k; break }
    if (next < 0) for (let k = this.count - 1; k >= 0; k--) if (!this.closed.has(k)) { next = k; break }
    this.cur = next < 0 ? index : next
  }
}
const tabName = (index: number) => index === 0 ? 'page' : 'page' + index

// ---------- helpers that generated/handwritten code may rely on ----------
const helperSources: Record<string, string[]> = {
  digits: ["const digits = text => text.replace(/[۰-۹]/g, d => String(d.charCodeAt(0) - 1776)).replace(/[٠-٩]/g, d => String(d.charCodeAt(0) - 1632))"],
  toNumber: ["const toNumber = text => Number(text.replace(/[,٬\\s\\u200c]/g, '').replace(/٫/g, '.'))"],
  toBoolean: ["const toBoolean = text => ['true', '1', 'yes', 'بله'].includes(text.toLowerCase())"],
  attempt: [
    'async function attempt(run, { retries = 0, delay = 1000, continueOnError = false } = {}) {',
    '  for (let n = 0; ; n++) {',
    '    try { return await run() } catch (error) {',
    '      if (n < retries) { await page.waitForTimeout(delay); continue }',
    '      if (continueOnError) return undefined',
    '      throw error',
    '    }',
    '  }',
    '}'
  ]
}

// ---------- code -> steps ----------
const BOILERPLATE = [
  /^import\b/,
  /^(?:const|let|var)\s*\{[^}]*\}\s*=\s*require\(/,
  /^(?:const|let|var)\s+(?:browser|context|page)\s*=\s*await\s+[\w.]+\.(?:launch|launchPersistentContext|newContext|newPage)\(/,
  /^await\s+(?:context|browser)\.close\(\s*\)/,
  /^return\s+output\b/,
  /^(?:const|let)\s+output\s*=\s*\{\s*\}/,
  /^page\.setDefaultTimeout\(/,
  /^(?:const|let)\s+(?:digits|toNumber|toBoolean)\s*=/,
  /^async\s+function\s+attempt\b/,
  /^(?:const|let)\s+tabs\s*=\s*\[\s*page\s*\]/,
  /^tabs\.push\(\s*[\w$]+\s*\)/
]
interface Item { src: string; kind: 'step' | 'code'; step?: ScenarioStep; title?: string; boundary?: boolean; synthetic?: boolean }
const clip = (text: string) => { const one = text.replace(/\s+/g, ' '); return one.length > 110 ? one.slice(0, 107) + '…' : one }
const strip = (text: string) => text.replace(/\s+/g, '')

export function codeToSteps(code: string): ConvertResult {
  const pieces = flatten(code)
  const tabs = new Tabs()
  const items: Item[] = []
  const skipped: string[] = []
  let title: string | undefined, number: number | undefined, marker: string | undefined, boundary = false
  let popup: { promise: string; from: string; decl: string; start: number } | undefined

  const consumeTitle = () => { const t = title; title = undefined; number = undefined; return t }
  const pushCode = (src: string) => { items.push({ src, kind: 'code', title: consumeTitle(), boundary }); boundary = false }
  const pushStep = (step: ScenarioStep, src: string) => {
    const t = consumeTitle()
    items.push({ src, kind: 'step', step: t ? { ...step, title: t } : step })
  }
  const switchTo = (index: number) => {
    if (tabs.cur === index) return
    tabs.cur = index
    items.push({ src: '', kind: 'step', synthetic: true, step: { ...createStep('tab'), type: 'tab', action: 'switch', index, title: 'رفتن به تب ' + (index + 1) } as ScenarioStep })
  }

  for (let p = 0; p < pieces.length; p++) {
    const piece = pieces[p]
    if (piece.kind === 'comment') {
      const numbered = /^(\d+)\.\s+(.+)$/.exec(piece.text)
      if (numbered) { number = Number(numbered[1]); title = numbered[2] }
      else if (/^@step\s+\{/.test(piece.text)) marker = piece.text.slice(6)
      else if (piece.text === '@code') boundary = true
      continue
    }
    const text = piece.text.replace(/;\s*$/, '')

    // A generated field/table/form block that is still unchanged becomes its original node again.
    if (marker) {
      const rawMarker = marker; marker = undefined
      try {
        const saved = JSON.parse(rawMarker) as ScenarioStep
        validateSteps([saved])
        const P = /\b(page\d*)\./.exec(text)?.[1] ?? 'page'
        if (number === undefined || !tabs.vars.has(P)) throw new Error('marker context')
        const expected = splitStatements(stepLines(saved, number - 1, P).filter(line => !line.trim().startsWith('//')).join('\n')).filter(x => x.kind === 'stmt').map(x => strip(x.text))
        const actual = pieces.slice(p).filter(x => x.kind === 'stmt').slice(0, expected.length).map(x => strip(x.text))
        if (expected.length && expected.length === actual.length && expected.every((line, k) => line === actual[k])) {
          switchTo(tabs.vars.get(P)!)
          let taken = 0, q = p
          while (taken < expected.length) { if (pieces[q].kind === 'stmt') taken++; q++ }
          items.push({ src: pieces.slice(p, q).filter(x => x.kind === 'stmt').map(x => x.text).join('\n'), kind: 'step', step: { ...saved, id: crypto.randomUUID(), title: title ?? saved.title } })
          consumeTitle(); p = q - 1
          continue
        }
      } catch { /* the block was edited: treat it as ordinary code below */ }
    }

    if (BOILERPLATE.some(pattern => pattern.test(text))) continue

    // const page1Promise = page.waitForEvent('popup')
    const popupDecl = /^(?:const|let|var)\s+([\w$]+)\s*=\s*([\w$]+)\.waitForEvent\(\s*['"]popup['"]\s*(?:,[\s\S]*)?\)$/.exec(text)
    if (popupDecl && tabs.vars.has(popupDecl[2]) && !popup) { popup = { promise: popupDecl[1], from: popupDecl[2], decl: text, start: items.length }; continue }
    const popupDone = popup && new RegExp('^(?:const|let|var)\\s+([\\w$]+)\\s*=\\s*await\\s+' + popup.promise.replace(/\$/g, '\\$') + '$').exec(text)
    if (popup && popupDone) {
      const made = items.slice(popup.start)
      const clickItem = made.length === 1 && made[0].kind === 'step' && made[0].step?.type === 'click' ? made[0] : undefined
      if (clickItem && clickItem.step?.type === 'click') {
        clickItem.step = { ...clickItem.step, opensTab: true }
        clickItem.src = popup.decl + '\n' + clickItem.src + '\n' + text
        tabs.open(popupDone[1])
      } else {
        const originals = made.filter(item => !item.synthetic).map(item => item.src)
        items.length = popup.start
        pushCode([popup.decl, ...originals, text].join('\n'))
      }
      popup = undefined
      continue
    }

    // await attempt(async () => { ... }, { retries, delay, continueOnError })
    const wrapped = /^await\s+attempt\(\s*async\s*\(\s*\)\s*=>\s*\{([\s\S]*)\}\s*,\s*\{([^}]*)\}\s*\)$/.exec(text)
    if (wrapped) {
      const inner = flatten(wrapped[1]).filter(x => x.kind === 'stmt')
      const single = inner.length === 1 ? convertStatement(inner[0].text.replace(/;\s*$/, ''), tabs) : undefined
      if (single && single.length === 1 && single[0].kind === 'step') {
        const retries = Number(/retries:\s*(\d+)/.exec(wrapped[2])?.[1] ?? 0)
        const delay = Number(/delay:\s*(\d+(?:\.\d+)?)/.exec(wrapped[2])?.[1] ?? 1000)
        const keep = /continueOnError:\s*true/.test(wrapped[2])
        const step = { ...single[0].step! } as ScenarioStep
        if (retries) { step.retries = Math.min(5, retries); step.retryDelaySec = Math.min(60, delay / 1000) }
        if (keep) step.continueOnError = true
        pushStep(step, text)
      } else pushCode(text)
      continue
    }

    // await expect(page.locator(..)).toBeVisible()  -> wait node; other assertions need the test runner and are reported
    const expectVisible = /^await\s+expect\(([\s\S]+)\)\.toBeVisible\(\s*\)$/.exec(text)
    if (expectVisible) {
      try {
        const { root, calls } = parseChain(expectVisible[1], new Set(tabs.vars.keys()))
        const { selector, rest } = selectorOf(calls)
        if (!selector || rest.length) throw new Error('unsupported')
        switchTo(tabs.vars.get(root)!)
        pushStep({ ...createStep('wait'), title: 'انتظار برای — ' + describe(selector), type: 'wait', selector } as ScenarioStep, text)
        continue
      } catch { /* reported below */ }
    }
    const expectUrl = /^await\s+expect\(\s*([\w$]+)\s*\)\.toHaveURL\(\s*('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")\s*\)$/.exec(text)
    if (expectUrl && tabs.vars.has(expectUrl[1])) {
      switchTo(tabs.vars.get(expectUrl[1])!)
      const url = new Reader(expectUrl[2]).string()
      pushStep({ ...createStep('waitPage'), title: 'انتظار برای آدرس — ' + short(url), type: 'waitPage', mode: 'url', url } as ScenarioStep, text)
      continue
    }
    if (/^(?:await\s+)?expect\s*[.(]/.test(text)) { skipped.push(clip(text) + ' — بررسی‌های expect به اجرای تست Playwright نیاز دارند'); consumeTitle(); continue }

    const converted = convertStatement(text, tabs)
    if (converted) {
      for (const item of converted) {
        if (item.kind === 'step') { pushStep(item.step!, item.src); if (item.synthetic) items[items.length - 1].synthetic = true }
        else pushCode(item.src)
      }
      // step conversion may have inserted tab switches before the real node; keep the cursor in sync
      continue
    }
    pushCode(text)
  }
  if (popup) { const originals = items.splice(popup.start).filter(item => !item.synthetic).map(item => item.src); pushCode([popup.decl, ...originals].join('\n')) }

  // A code block that declares a variable must stay together with every later statement that uses it.
  const declared = (src: string): string[] => {
    const first = src.split('\n')[0]
    const names: string[] = []
    const simple = /^(?:const|let|var)\s+([A-Za-z_$][\w$]*)/.exec(first)
    if (simple) names.push(simple[1])
    const pattern = /^(?:const|let|var)\s*[[{]([^\]}]*)[\]}]/.exec(first)
    if (pattern) for (const part of pattern[1].split(',')) { const name = part.split(':').pop()!.split('=')[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(name)) names.push(name) }
    const fn = /^(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/.exec(first)
    if (fn) names.push(fn[1])
    return names
  }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < items.length; i++) {
      if (items[i].kind !== 'code') continue
      for (const name of declared(items[i].src)) {
        const re = new RegExp('(?<![\\w$.])' + name.replace(/\$/g, '\\$') + '(?![\\w$])')
        let last = -1
        for (let j = items.length - 1; j > i; j--) if (re.test(items[j].src)) { last = j; break }
        if (last < 0) continue
        for (let k = i + 1; k <= last; k++) if (items[k].kind !== 'code') { items[k] = { src: items[k].src, kind: 'code', title: items[k].title }; changed = true }
      }
    }
  }
  const dropped = items.filter(item => item.kind === 'code' && !item.src.trim())
  void dropped

  // Group neighbouring code items and attach the helper definitions they rely on.
  const steps: ScenarioStep[] = []
  let custom = 0
  const taken = new Set<string>()
  const finish = (step: ScenarioStep, src: string) => {
    try {
      if (step.type === 'screenshot') { let name = step.name, n = 2; while (taken.has(name)) name = step.name + '_' + n++; taken.add(name); step = { ...step, name } }
      validateSteps([step]); steps.push(step); return true
    } catch { return false }
  }
  const pendingCode: string[] = []
  let pendingTitle: string | undefined
  const flushCode = () => {
    if (!pendingCode.length) return
    let body = pendingCode.join('\n')
    const prelude: string[] = []
    for (const [name, lines] of Object.entries(helperSources)) if (new RegExp('(?<![\\w$.])' + name + '\\s*\\(').test(body) && !new RegExp('(?:const|function)\\s+' + name + '\\b').test(body)) prelude.push(...lines)
    for (const [variable, index] of tabs.vars) if (variable !== 'page' && new RegExp('(?<![\\w$.])' + variable + '(?![\\w$])').test(body) && !new RegExp('(?:const|let|var)\\s+' + variable + '\\b').test(body)) prelude.push('const ' + variable + ' = tabs[' + index + ']')
    body = [...prelude, body].join('\n')
    const step = { ...createStep('code'), type: 'code', code: body, title: pendingTitle ?? 'کد سفارشی' } as ScenarioStep
    if (finish(step, body)) custom++; else skipped.push(clip(body))
    pendingCode.length = 0; pendingTitle = undefined
  }
  for (const item of items) {
    if (item.kind === 'code') {
      if (!item.src.trim()) continue
      if (item.boundary) flushCode()
      if (!pendingCode.length) pendingTitle = item.title
      pendingCode.push(item.src)
    } else {
      flushCode()
      if (!finish(item.step!, item.src)) {
        if (item.src.trim()) { pendingCode.push(item.src) ; flushCode() } else skipped.push(item.step!.title)
      }
    }
  }
  flushCode()
  try { if (steps.length) validateSteps(steps) } catch (error) { return { steps: [], skipped: [...skipped, String((error as Error).message)], exact: false, custom } }
  return { steps, skipped, exact: skipped.length === 0 && steps.length > 0, custom }
}

// One statement -> items (possibly a tab switch plus the node), or undefined when it needs a code node.
function convertStatement(text: string, tabs: Tabs): Item[] | undefined {
  const roots = new Set(tabs.vars.keys())
  const lead = /^(?:await\s+)?([A-Za-z_$][\w$]*)\s*\./.exec(text)?.[1]
  if (!lead || !roots.has(lead) || !TAB_VAR.test(lead)) return undefined
  const index = tabs.vars.get(lead)!
  const out: Item[] = []
  const withSwitch = (item: Item) => {
    if (tabs.cur !== index) { tabs.cur = index; out.push({ src: '', kind: 'step', synthetic: true, step: { ...createStep('tab'), type: 'tab', action: 'switch', index, title: 'رفتن به تب ' + (index + 1) } as ScenarioStep }) }
    out.push(item)
  }
  try {
    if (new RegExp('^(?:await\\s+)?' + lead.replace(/\$/g, '\\$') + '\\.close\\(\\s*\\)$').test(text)) {
      withSwitch({ src: text, kind: 'step', step: { ...createStep('tab'), type: 'tab', action: 'close', index, title: 'بستن تب ' + (index + 1) } as ScenarioStep })
      tabs.close(index)
      return out
    }
    const dialog = new RegExp('^' + lead.replace(/\$/g, '\\$') + '\\.(?:once|on)\\(\\s*[\'"]dialog[\'"]\\s*,\\s*\\(?\\s*(\\w+)\\s*\\)?\\s*=>\\s*([\\s\\S]*)\\)$').exec(text)
    if (dialog) {
      const verbs = [...dialog[2].matchAll(/\.(accept|dismiss)\(/g)].map(m => m[1])
      if (verbs.length !== 1) throw new Error('dialog handler')
      const action = verbs[0] as 'accept' | 'dismiss'
      withSwitch({ src: text, kind: 'step', step: { ...createStep('dialog'), type: 'dialog', action, title: action === 'accept' ? 'تأیید پیام (دیالوگ)' : 'رد کردن پیام (دیالوگ)' } as ScenarioStep })
      return out
    }
    const { step } = statementToStep(text, roots)
    if (!step) return []
    withSwitch({ src: text, kind: 'step', step })
    return out
  } catch { return undefined }
}

// ---------- steps -> readable Playwright code ----------
const str = (value: string) => JSON.stringify(value)
const valueCode = (source: ValueSource): string => {
  if (source.kind === 'literal') return str(source.value)
  if (source.kind === 'secret') return 'secrets[' + str(source.value) + ']'
  return 'input' + source.value.split('.').map(key => /^\d+$/.test(key) ? '?.[' + key + ']' : '?.[' + str(key) + ']').join('')
}
const convertCode = (expr: string, e: { dataType: string; normalizeDigits: boolean }) => {
  const text = e.normalizeDigits ? 'digits(' + expr + '.trim())' : expr + '.trim()'
  return e.dataType === 'number' ? 'toNumber(' + (e.normalizeDigits ? 'digits(' + expr + ')' : expr) + ')' : e.dataType === 'boolean' ? 'toBoolean(' + text + ')' : text
}

// Code lines of one node (without the title comment). P is the variable of the active tab.
function stepLines(step: ScenarioStep, index: number, P: string): string[] {
  const body: string[] = []
  const loc = 'selector' in step ? P + '.locator(' + str(step.selector) + ')' : ''
  switch (step.type) {
    case 'navigate': body.push('await ' + P + '.goto(' + valueCode(step.url) + ", { waitUntil: 'domcontentloaded', timeout: 30000 })"); break
    case 'fill': body.push('await ' + loc + (step.typing ? '.pressSequentially(' : '.fill(') + valueCode(step.value) + ')'); break
    case 'click': {
      const opt = step.button && step.button !== 'left' ? '{ button: ' + str(step.button) + ' }' : ''
      body.push('await ' + loc + (step.double ? '.dblclick(' : '.click(') + opt + ')'); break
    }
    case 'hover': body.push('await ' + loc + '.hover()'); break
    case 'wait': body.push('await ' + loc + ".waitFor({ state: 'visible' })"); break
    case 'check': body.push('await ' + loc + '.setChecked(' + step.checked + ')'); break
    case 'select': body.push('await ' + loc + '.selectOption({ ' + (step.by === 'label' ? 'label' : 'value') + ': ' + valueCode(step.value) + ' })'); break
    case 'press': body.push(step.selector ? 'await ' + loc + '.press(' + str(step.key) + ')' : 'await ' + P + '.keyboard.press(' + str(step.key) + ')'); break
    case 'pause': body.push('await ' + P + '.waitForTimeout(' + Math.round(step.seconds * 1000) + ')'); break
    case 'scroll': body.push(step.to === 'element' ? 'await ' + loc + '.scrollIntoViewIfNeeded()' : 'await ' + P + '.evaluate(() => window.scrollTo({ top: ' + (step.to === 'top' ? '0' : 'document.documentElement.scrollHeight') + ' }))'); break
    case 'screenshot': body.push('await ' + P + '.screenshot({ path: ' + str('shot-' + step.name + '.png') + ', fullPage: ' + step.fullPage + ' })'); break
    case 'waitPage': body.push(step.mode === 'url' ? 'await ' + P + '.waitForURL(' + str(step.url) + ', { timeout: 30000 })' : 'await ' + P + '.waitForLoadState(' + str(step.mode) + ')'); break
    case 'history': body.push('await ' + P + '.' + (step.action === 'reload' ? 'reload' : step.action === 'back' ? 'goBack' : 'goForward') + '()'); break
    case 'dialog': body.push(P + ".once('dialog', dialog => dialog." + (step.action === 'accept' ? 'accept' : 'dismiss') + '().catch(() => {}))'); break
    case 'tab': if (step.action === 'close') body.push('await ' + P + '.close()'); break
    case 'code': body.push(...step.code.split('\n')); break
    case 'form':
      for (const field of step.fields) {
        const target = P + '.locator(' + str(field.selector) + ')'
        if (field.action === 'fill') body.push('await ' + target + '.fill(' + valueCode(field.value) + ')')
        else if (field.action === 'select') body.push('await ' + target + '.selectOption({ ' + (field.by === 'label' ? 'label' : 'value') + ': ' + valueCode(field.value) + ' })')
        else body.push('await ' + target + '.setChecked(' + (field.action === 'check') + ')')
      }
      break
    case 'field': {
      const e = step.extraction
      const el = P + '.locator(' + str(e.selector) + ')'
      const raw = e.read === 'value' ? 'await ' + el + '.inputValue()' : e.read === 'attribute' ? 'await ' + el + '.getAttribute(' + str(e.attribute) + ')' : 'await ' + el + '.innerText()'
      if (e.missing === 'null') body.push('if (await ' + el + '.count() === 0) output.' + step.name + ' = null', 'else {', '  const raw = ' + raw, '  output.' + step.name + ' = raw === null ? null : ' + convertCode('raw', e), '}')
      else body.push('{', '  const raw = ' + raw, '  if (raw === null) throw new Error(' + str('ویژگی روی عنصر وجود ندارد: ' + e.attribute) + ')', '  output.' + step.name + ' = ' + convertCode('raw', e), '}')
      break
    }
    case 'table': {
      const cols = step.columns.map(c => '{ selector: ' + str(c.selector) + ', read: ' + str(c.read) + ', attribute: ' + str(c.attribute) + ' }').join(', ')
      body.push(
        'const rows' + index + ' = await ' + P + '.locator(' + str(step.rowSelector) + ').evaluateAll((rows, cols) => rows.map(row => cols.map(col => {',
        '  const el = row.querySelector(col.selector)',
        "  return el ? (col.read === 'value' ? el.value : col.read === 'attribute' ? el.getAttribute(col.attribute) : el.innerText) : null",
        '})), [' + cols + '])',
        ...(step.empty === 'error' ? ['if (!rows' + index + '.length) throw new Error(' + str('هیچ ردیفی پیدا نشد') + ')'] : []),
        'output.' + step.name + ' = rows' + index + '.map(cells => ({',
        ...step.columns.map((c, i) => '  ' + c.name + ': cells[' + i + '] === null ? null : ' + convertCode('cells[' + i + ']', c) + ','),
        '}))'
      )
      break
    }
  }
  if (step.retries || step.continueOnError) {
    return ['await attempt(async () => {', ...body.map(line => '  ' + line), '}, { retries: ' + (step.retries ?? 0) + ', delay: ' + Math.round((step.retryDelaySec ?? 1) * 1000) + ', continueOnError: ' + (step.continueOnError === true) + ' })']
  }
  return body
}

export function stepsToCode(steps: ScenarioStep[]): string {
  const needs = (test: (step: ScenarioStep) => boolean) => steps.some(test)
  const lines: string[] = ['// کد خوانا از روی نودها. دستورهای شناخته‌شده هنگام بازگشت به حالت دستی دوباره نود می‌شوند و بقیه به «کد سفارشی» تبدیل می‌شوند.', 'const output = {}']
  if (needs(step => step.type === 'field' || step.type === 'table')) for (const name of ['digits', 'toNumber', 'toBoolean']) lines.push(...helperSources[name])
  if (needs(step => !!step.retries || !!step.continueOnError)) lines.push(...helperSources.attempt)
  if (needs(step => step.type === 'tab' || step.type === 'code' || (step.type === 'click' && step.opensTab === true))) lines.push('const tabs = [page]')
  lines.push('page.setDefaultTimeout(10000)', '')
  const tabs = new Tabs()
  steps.forEach((step, index) => {
    lines.push('// ' + (index + 1) + '. ' + step.title.replace(/\n/g, ' '))
    if (step.type === 'field' || step.type === 'table' || step.type === 'form') lines.push('// @step ' + JSON.stringify(step))
    if (step.type === 'code') lines.push('// @code')
    const P = tabName(tabs.cur)
    if (step.type === 'tab') {
      if (step.action === 'close') { lines.push(...stepLines(step, index, P)); tabs.close(tabs.cur) }
      else tabs.cur = step.index
      return
    }
    if (step.type === 'click' && step.opensTab) {
      const n = tabs.count
      lines.push('const ' + tabName(n) + 'Promise = ' + P + ".waitForEvent('popup')", ...stepLines({ ...step, retries: undefined, continueOnError: undefined }, index, P), 'const ' + tabName(n) + ' = await ' + tabName(n) + 'Promise', 'tabs.push(' + tabName(n) + ')')
      tabs.open(tabName(n))
      return
    }
    lines.push(...stepLines(step, index, P))
  })
  lines.push('', 'return output', '')
  return lines.join('\n')
}
