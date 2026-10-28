import React, { useState } from 'react'
import type { Extraction, FormField, PickRequest, ScenarioStep, ValueSource } from '../shared/types'
import { defaultExtraction, stepLabels } from '../shared/steps'
import { ContextMenu } from './ContextMenu'

type Props = { step: ScenarioStep; onChange: (step: ScenarioStep) => void; pick: (request: PickRequest, apply: (selector: string) => void) => void; canPick: boolean; locked: boolean; secretNames: string[] }
const keyNames = ['Enter', 'Tab', 'Escape', 'Backspace', 'Delete', 'Space', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'PageDown', 'PageUp', 'Home', 'End', 'Control+A']
const typeIcons: Partial<Record<ScenarioStep['type'], string>> = { form: '☰', code: '</>', tab: '⧉', dialog: '💬', waitPage: '⏳', history: '↻', table: '▦', field: '⌗', pause: '⏱', screenshot: '▣', press: '⌨', scroll: '⇅', select: '☰', check: '☑', hover: '⌖' }

function SourceEditor({ value, onChange, label, secretNames }: { value: ValueSource; onChange: (value: ValueSource) => void; label: string; secretNames: string[] }) {
  return <div className="form-grid">
    <label>منبع {label}<select aria-label={'منبع ' + label} value={value.kind} onChange={e => onChange({ ...value, kind: e.target.value as ValueSource['kind'] })}><option value="literal">مقدار ثابت</option><option value="input">از ورودی n8n</option><option value="secret">رمز ذخیره‌شده</option></select></label>
    <label>{value.kind === 'input' ? 'مسیر در input' : value.kind === 'secret' ? 'نام رمز' : label}<input dir="ltr" aria-label={label} list={value.kind === 'secret' ? 'secret-names' : undefined} value={value.value} placeholder={value.kind === 'input' ? 'order.id' : value.kind === 'secret' ? 'site_password' : ''} onChange={e => onChange({ ...value, value: e.target.value })} /></label>
    {value.kind === 'secret' && <><datalist id="secret-names">{secretNames.map(name => <option key={name} value={name} />)}</datalist><p className="hint span-all">{secretNames.length ? 'رمز از بخش «تنظیمات اتصال ← رمزها» خوانده می‌شود و در لاگ و خروجی نمایش داده نمی‌شود.' : 'هنوز رمزی ذخیره نشده است؛ آن را در «تنظیمات اتصال ← رمزها» اضافه کنید.'}</p></>}
    {value.kind === 'input' && <p className="hint span-all">مثلاً <code>order.id</code> مقدار <code>input.order.id</code> را می‌خواند؛ کدنویسی لازم نیست.</p>}
  </div>
}

function ExtractEditor({ value, onChange, choose, canPick, label }: { value: Extraction; onChange: (value: Extraction) => void; choose: () => void; canPick: boolean; label: string }) {
  return <>
    <label>عنصر موردنظر<div className="input-action"><input aria-label={'انتخابگر ' + label} dir="ltr" value={value.selector} placeholder="عنصر را از مرورگر انتخاب کنید" onChange={e => onChange({ ...value, selector: e.target.value })} /><button type="button" className="pick-button" disabled={!canPick} onClick={choose} aria-label={'انتخاب ' + label + ' از صفحه'}>⌖ انتخاب از صفحه</button></div></label>
    <div className="form-grid">
      <label>چه چیزی خوانده شود؟<select aria-label={'روش خواندن ' + label} value={value.read} onChange={e => onChange({ ...value, read: e.target.value as Extraction['read'] })}><option value="text">متن عنصر</option><option value="value">مقدار کادر ورودی</option><option value="attribute">ویژگی عنصر (لینک و…)</option></select></label>
      <label>نوع داده در JSON<select aria-label={'نوع داده ' + label} value={value.dataType} onChange={e => onChange({ ...value, dataType: e.target.value as Extraction['dataType'] })}><option value="text">متن</option><option value="number">عدد</option><option value="boolean">بله / خیر</option></select></label>
      {value.read === 'attribute' && <label>نام ویژگی<input aria-label={'ویژگی ' + label} dir="ltr" placeholder="href" value={value.attribute} onChange={e => onChange({ ...value, attribute: e.target.value })} /></label>}
      <label>اگر عنصر پیدا نشد<select aria-label={'عنصر ناموجود ' + label} value={value.missing} onChange={e => onChange({ ...value, missing: e.target.value as Extraction['missing'] })}><option value="error">توقف با خطا</option><option value="null">برگرداندن null</option></select></label>
      <div className="checkbox-stack"><label className="check"><input type="checkbox" checked={value.normalizeDigits} onChange={e => onChange({ ...value, normalizeDigits: e.target.checked })} />تبدیل ارقام فارسی و عربی</label>{value.dataType === 'number' && <label className="check"><input type="checkbox" checked={value.removeSeparators} onChange={e => onChange({ ...value, removeSeparators: e.target.checked })} />حذف جداکننده هزارگان و فاصله</label>}</div>
    </div>
  </>
}

function PickRow({ step, onChange, pick, canPick, optional }: { step: Extract<ScenarioStep, { selector: string }>; onChange: (step: ScenarioStep) => void; pick: Props['pick']; canPick: boolean; optional?: boolean }) {
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const choose = () => pick({ kind: 'element' }, selector => onChange({ ...step, selector }))
  return <label onContextMenu={event => { event.preventDefault(); setMenu({ x: event.clientX, y: event.clientY }) }}>{menu && <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)} items={[
      { kind: 'header', label: 'انتخابگر عنصر' },
      { label: 'انتخاب عنصر از صفحه', icon: '⌖', disabled: !canPick, hint: canPick ? '' : 'مرورگر را باز کنید', onClick: choose },
      { label: 'کپی انتخابگر', icon: '⧉', disabled: !step.selector, onClick: () => { void navigator.clipboard?.writeText(step.selector).catch(() => undefined) } },
      { label: 'چسباندن از کلیپ‌بورد', icon: '⎘', onClick: () => { void navigator.clipboard?.readText().then(text => { if (text.trim()) onChange({ ...step, selector: text.trim() }) }).catch(() => undefined) } },
      { kind: 'separator' },
      { label: 'پاک‌کردن', icon: '✕', danger: true, disabled: !step.selector, onClick: () => onChange({ ...step, selector: '' }) }
    ]} />}{optional ? 'عنصر موردنظر (اختیاری)' : 'عنصر موردنظر'}<div className="input-action"><input dir="ltr" aria-label="انتخابگر مرحله" value={step.selector} placeholder={optional ? 'خالی = کل صفحه' : 'عنصر را از صفحه انتخاب کنید'} onChange={e => onChange({ ...step, selector: e.target.value })} /><button className="pick-button" disabled={!canPick} onClick={() => pick({ kind: 'element' }, selector => onChange({ ...step, selector }))}>⌖ انتخاب از صفحه</button></div></label>
}

function AdvancedOptions({ step, onChange }: { step: ScenarioStep; onChange: (step: ScenarioStep) => void }) {
  const active = !!step.retries || !!step.continueOnError
  return <details className="advanced-options" open={active}><summary>خطا و تلاش مجدد{active ? ' · فعال' : ''}</summary><div className="form-grid">
    <label>تعداد تلاش مجدد<input type="number" aria-label="تعداد تلاش مجدد" min={0} max={5} value={step.retries ?? 0} onChange={e => onChange({ ...step, retries: Math.max(0, Math.min(5, Math.trunc(Number(e.target.value) || 0))) })} /></label>
    <label>فاصله بین تلاش‌ها (ثانیه)<input type="number" aria-label="فاصله تلاش مجدد" min={0} max={60} step={0.5} value={step.retryDelaySec ?? 1} onChange={e => onChange({ ...step, retryDelaySec: Math.max(0, Math.min(60, Number(e.target.value) || 0)) })} /></label>
    <label className="check span-all"><input type="checkbox" checked={step.continueOnError === true} onChange={e => onChange({ ...step, continueOnError: e.target.checked })} />اگر این مرحله شکست خورد، سناریو ادامه یابد (خروجی آن <code>null</code> می‌شود)</label>
    <p className="hint span-all">تلاش مجدد، کل مرحله را دوباره اجرا می‌کند؛ برای کلیک روی دکمه‌های ثبت یا پرداخت که اثر جانبی دارند فعالش نکنید.</p>
  </div></details>
}

function FormEditor({ step, onChange, pick, canPick, secretNames }: { step: Extract<ScenarioStep, { type: 'form' }>; onChange: (step: ScenarioStep) => void; pick: Props['pick']; canPick: boolean; secretNames: string[] }) {
  const update = (id: string, patch: Partial<FormField>) => onChange({ ...step, fields: step.fields.map(field => field.id === id ? { ...field, ...patch } : field) })
  const add = () => onChange({ ...step, fields: [...step.fields, { id: crypto.randomUUID(), selector: '', action: 'fill', value: { kind: 'literal', value: '' } }] })
  const move = (index: number, offset: number) => { const next = [...step.fields]; const to = index + offset; if (to < 0 || to >= next.length) return; [next[index], next[to]] = [next[to], next[index]]; onChange({ ...step, fields: next }) }
  return <>
    <div className="columns-heading"><h3>فیلدهای فرم <span className="count">{step.fields.length}</span></h3><button type="button" className="text-button" disabled={step.fields.length >= 60} onClick={add}>＋ افزودن فیلد</button></div>
    {step.fields.map((field, index) => <section className="column-card" key={field.id} aria-label={'فیلد ' + (index + 1)}>
      <div className="column-title"><span className="number">{index + 1}</span>
        <label>نوع<select aria-label={'نوع فیلد ' + (index + 1)} value={field.action} onChange={e => update(field.id, { action: e.target.value as FormField['action'] })}><option value="fill">نوشتن متن</option><option value="select">انتخاب از لیست</option><option value="check">تیک زدن</option><option value="uncheck">برداشتن تیک</option></select></label>
        <button type="button" className="icon-button" aria-label="بالا" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
        <button type="button" className="icon-button" aria-label="پایین" disabled={index === step.fields.length - 1} onClick={() => move(index, 1)}>↓</button>
        <button type="button" className="icon-button danger" aria-label={'حذف فیلد ' + (index + 1)} disabled={step.fields.length === 1} onClick={() => onChange({ ...step, fields: step.fields.filter(item => item.id !== field.id) })}>×</button></div>
      <label>عنصر<div className="input-action"><input dir="ltr" aria-label={'انتخابگر فیلد ' + (index + 1)} value={field.selector} placeholder="عنصر را از صفحه انتخاب کنید" onChange={e => update(field.id, { selector: e.target.value })} /><button type="button" className="pick-button" disabled={!canPick} onClick={() => pick({ kind: 'element' }, selector => update(field.id, { selector }))}>انتخاب از صفحه</button></div></label>
      {(field.action === 'fill' || field.action === 'select') && <SourceEditor label={field.action === 'fill' ? 'مقدار فیلد ' + (index + 1) : 'گزینهٔ فیلد ' + (index + 1)} secretNames={secretNames} value={field.value} onChange={value => update(field.id, { value })} />}
      {field.action === 'select' && <label>گزینه بر اساس<select aria-label={'روش انتخاب فیلد ' + (index + 1)} value={field.by ?? 'value'} onChange={e => update(field.id, { by: e.target.value as 'value' | 'label' })}><option value="value">مقدار (value)</option><option value="label">متن نمایش‌داده‌شده</option></select></label>}
    </section>)}
    <p className="hint">همهٔ فیلدها پشت‌سرهم و به ترتیب پر می‌شوند؛ برای ورودی از n8n «از ورودی n8n» را انتخاب کنید.</p>
  </>
}

export function StepEditor({ step, onChange, pick, canPick, locked, secretNames }: Props) {
  return <fieldset disabled={locked} className="step-form">
    <div className="section-heading"><div className="step-name-heading"><span className="eyebrow">{stepLabels[step.type]}</span><input className="step-name" aria-label="عنوان مرحله" value={step.title} onChange={e => onChange({ ...step, title: e.target.value })} /></div><span className="type-icon">{typeIcons[step.type] ?? '↗'}</span></div>
    {step.type === 'navigate' && <SourceEditor label="آدرس صفحه" secretNames={secretNames} value={step.url} onChange={url => onChange({ ...step, url })} />}
    {(step.type === 'click' || step.type === 'fill' || step.type === 'wait' || step.type === 'hover' || step.type === 'select' || step.type === 'check') && <PickRow step={step} onChange={onChange} pick={pick} canPick={canPick} />}
    {step.type === 'fill' && <>
      <SourceEditor label="مقدار ورودی" secretNames={secretNames} value={step.value} onChange={value => onChange({ ...step, value })} />
      <label className="check"><input type="checkbox" checked={step.typing === true} onChange={e => onChange({ ...step, typing: e.target.checked })} />کاراکتر به کاراکتر تایپ شود (برای کادرهایی که با تایپ واقعی فعال می‌شوند؛ متن قبلی پاک نمی‌شود)</label>
    </>}
    {step.type === 'click' && <div className="form-grid">
      <label>دکمهٔ ماوس<select aria-label="دکمه ماوس" value={step.button ?? 'left'} onChange={e => onChange({ ...step, button: e.target.value === 'left' ? undefined : e.target.value as 'right' | 'middle' })}><option value="left">چپ (معمولی)</option><option value="right">راست</option><option value="middle">وسط</option></select></label>
      <div className="checkbox-stack"><label className="check"><input type="checkbox" checked={step.double === true} onChange={e => onChange({ ...step, double: e.target.checked || undefined })} />دوبار کلیک</label>
      <label className="check"><input type="checkbox" checked={step.opensTab === true} onChange={e => onChange({ ...step, opensTab: e.target.checked || undefined })} />این کلیک تب یا پنجرهٔ جدید باز می‌کند (مراحل بعد روی تب جدید اجرا شوند)</label></div>
    </div>}
    {step.type === 'form' && <FormEditor step={step} onChange={onChange} pick={pick} canPick={canPick} secretNames={secretNames} />}
    {step.type === 'waitPage' && <>
      <label>منتظر چه چیزی باشد؟<select aria-label="نوع انتظار" value={step.mode} onChange={e => onChange({ ...step, mode: e.target.value as typeof step.mode })}><option value="load">پایان بارگذاری صفحه (load)</option><option value="domcontentloaded">پایان بارگذاری HTML</option><option value="networkidle">آرام شدن درخواست‌های شبکه</option><option value="url">رسیدن به یک آدرس مشخص</option></select></label>
      {step.mode === 'url' && <label>آدرس یا الگو<input dir="ltr" aria-label="آدرس انتظار" value={step.url} placeholder="**/dashboard" onChange={e => onChange({ ...step, url: e.target.value })} /></label>}
      <p className="hint">حداکثر ۳۰ ثانیه منتظر می‌ماند. در الگوی آدرس <code>**</code> یعنی هر مسیری.</p>
    </>}
    {step.type === 'history' && <label>عمل<select aria-label="عمل تاریخچه" value={step.action} onChange={e => onChange({ ...step, action: e.target.value as typeof step.action })}><option value="reload">بارگذاری مجدد صفحه</option><option value="back">برگشت به صفحهٔ قبل</option><option value="forward">رفتن به صفحهٔ بعد</option></select></label>}
    {step.type === 'tab' && <>
      <label>عمل<select aria-label="عمل تب" value={step.action} onChange={e => onChange({ ...step, action: e.target.value as 'switch' | 'close' })}><option value="switch">رفتن به یک تب</option><option value="close">بستن تب فعلی</option></select></label>
      {step.action === 'switch' && <label>شمارهٔ تب (۱ = صفحهٔ اول)<input type="number" dir="ltr" aria-label="شماره تب" min={1} max={31} value={step.index + 1} onChange={e => onChange({ ...step, index: Math.max(0, Math.min(30, Math.trunc(Number(e.target.value) || 1) - 1)) })} /></label>}
      <p className="hint">تب‌ها به ترتیب بازشدن شماره‌گذاری می‌شوند. بعد از بستن تب، اجرا به تب قبلی برمی‌گردد.</p>
    </>}
    {step.type === 'dialog' && <>
      <label>پاسخ به پیام‌های alert / confirm<select aria-label="پاسخ دیالوگ" value={step.action} onChange={e => onChange({ ...step, action: e.target.value as 'accept' | 'dismiss' })}><option value="accept">تأیید (OK)</option><option value="dismiss">رد کردن (Cancel)</option></select></label>
      <p className="hint">این مرحله را <b>قبل از</b> کاری که پیام را باز می‌کند بگذارید؛ فقط برای اولین پیام بعدی اعمال می‌شود.</p>
    </>}
    {step.type === 'code' && <>
      <label>کد سفارشی<textarea className="code-area" dir="ltr" aria-label="کد سفارشی" spellCheck={false} rows={12} value={step.code} onChange={e => onChange({ ...step, code: e.target.value })} /></label>
      <p className="hint">متغیرهای <code>page</code> (تب فعلی)، <code>tabs</code>، <code>input</code>، <code>output</code> و <code>secrets</code> در دسترس‌اند. برای برگرداندن داده، مثلاً <code>output.title = await page.title()</code>. این کد با دسترسی کامل اجرا می‌شود؛ فقط کدی که خودتان نوشته‌اید یا به آن اعتماد دارید را بگذارید.</p>
    </>}
    {step.type === 'select' && <>
      <SourceEditor label="گزینه موردنظر" secretNames={secretNames} value={step.value} onChange={value => onChange({ ...step, value })} />
      <label>گزینه بر اساس<select aria-label="روش انتخاب گزینه" value={step.by} onChange={e => onChange({ ...step, by: e.target.value as 'value' | 'label' })}><option value="value">مقدار (value)</option><option value="label">متن نمایش‌داده‌شده</option></select></label>
    </>}
    {step.type === 'check' && <label>وضعیت موردنظر<select aria-label="وضعیت تیک" value={step.checked ? 'on' : 'off'} onChange={e => onChange({ ...step, checked: e.target.value === 'on' })}><option value="on">تیک زده شود</option><option value="off">تیک برداشته شود</option></select></label>}
    {step.type === 'press' && <>
      <PickRow step={step} onChange={onChange} pick={pick} canPick={canPick} optional />
      <label>کلید<input dir="ltr" aria-label="کلید" list="key-names" value={step.key} placeholder="Enter" onChange={e => onChange({ ...step, key: e.target.value })} /></label>
      <datalist id="key-names">{keyNames.map(name => <option key={name} value={name} />)}</datalist>
      <p className="hint">مثلاً <code>Enter</code> بعد از نوشتن در کادر جستجو، یا <code>Control+A</code>. اگر عنصری انتخاب نشود، کلید روی کل صفحه فشرده می‌شود.</p>
    </>}
    {step.type === 'scroll' && <>
      <label>اسکرول به<select aria-label="مقصد اسکرول" value={step.to} onChange={e => onChange({ ...step, to: e.target.value as 'top' | 'bottom' | 'element' })}><option value="bottom">پایین صفحه</option><option value="top">بالای صفحه</option><option value="element">یک عنصر مشخص</option></select></label>
      {step.to === 'element' && <PickRow step={step} onChange={onChange} pick={pick} canPick={canPick} />}
      <p className="hint">برای صفحه‌هایی که با اسکرول داده بیشتری بارگذاری می‌کنند، چند بار اسکرول به پایین را با یک «ماندن در صفحه» کوتاه ترکیب کنید.</p>
    </>}
    {step.type === 'screenshot' && <>
      <label>نام فایل<input dir="ltr" aria-label="نام اسکرین‌شات" value={step.name} placeholder="result" onChange={e => onChange({ ...step, name: e.target.value })} /></label>
      <label className="check"><input type="checkbox" checked={step.fullPage} onChange={e => onChange({ ...step, fullPage: e.target.checked })} />کل صفحه (نه فقط بخش دیده‌شده)</label>
      <p className="hint">تصویر در اجرای کامل ذخیره می‌شود؛ در «فقط همین مرحله» چیزی ذخیره نمی‌شود. آن را از تب «تصاویر» یا با <code>GET /api/runs/RUN_ID/artifacts/shot-{step.name || 'name'}.png</code> بگیرید.</p>
    </>}
    {step.type === 'pause' && <>
      <label>مدت ماندن در صفحه (ثانیه)<input type="number" dir="ltr" aria-label="مدت ماندن در صفحه" min={0.1} max={3600} step={0.5} value={step.seconds} onChange={e => onChange({ ...step, seconds: Number(e.target.value) })} /></label>
      <p className="hint">مرورگر به همین مدت روی صفحه فعلی می‌ماند و بعد به مرحله بعدی می‌رود. این زمان جزو مهلت کل اجرا حساب می‌شود؛ مهلت اجرا را در تنظیمات یا درخواست API بیشتر از مجموع مدت‌ها بگذارید. در «فقط همین مرحله» برای سرعت حداکثر ۲ ثانیه صبر می‌شود.</p>
    </>}
    {step.type === 'wait' && <p className="hint">تا نمایش عنصر، حداکثر ۱۰ ثانیه منتظر می‌ماند. برای نتایج جستجو و جدول‌های پویا از این مرحله استفاده کنید.</p>}
    {step.type === 'field' && <>
      <label>نام خروجی<input dir="ltr" aria-label="نام خروجی" value={step.name} placeholder="customerName" onChange={e => onChange({ ...step, name: e.target.value })} /></label>
      <p className="output-path">مسیر در n8n <code>output.{step.name || 'field'}</code></p>
      <ExtractEditor label="فیلد" value={step.extraction} canPick={canPick} onChange={extraction => onChange({ ...step, extraction })} choose={() => pick({ kind: 'element' }, selector => onChange({ ...step, extraction: { ...step.extraction, selector } }))} />
    </>}
    {step.type === 'table' && <>
      <label>نام جدول در خروجی<input dir="ltr" aria-label="نام خروجی" value={step.name} placeholder="items" onChange={e => onChange({ ...step, name: e.target.value })} /></label>
      <p className="output-path">مسیر در n8n <code>output.{step.name || 'items'}[]</code></p>
      <label>ردیف‌های جدول<div className="input-action"><input aria-label="انتخابگر ردیف‌ها" dir="ltr" value={step.rowSelector} placeholder="#orders tbody tr" onChange={e => onChange({ ...step, rowSelector: e.target.value })} /><button disabled={!canPick} className="pick-button" onClick={() => pick({ kind: 'rows' }, rowSelector => onChange({ ...step, rowSelector }))}>⌖ انتخاب ردیف‌ها</button></div></label>
      <p className="hint">یک ردیف داده را انتخاب کنید؛ سپس سلول هر ستون را انتخاب کنید. انتخابگر ستون نسبت به هر ردیف محاسبه می‌شود.</p>
      <div className="columns-heading"><h3>ستون‌های خروجی <span className="count">{step.columns.length}</span></h3><button className="text-button" onClick={() => onChange({ ...step, columns: [...step.columns, { ...defaultExtraction(), id: crypto.randomUUID(), name: 'column' + (step.columns.length + 1) }] })}>＋ افزودن ستون</button></div>
      {step.columns.map((column, index) => <section className="column-card" key={column.id} aria-label={'ستون ' + (index + 1)}>
        <div className="column-title"><span className="number">{index + 1}</span><label>نام ستون<input dir="ltr" aria-label={'نام ستون ' + (index + 1)} value={column.name} onChange={e => onChange({ ...step, columns: step.columns.map(c => c.id === column.id ? { ...c, name: e.target.value } : c) })} /></label><button className="icon-button danger" aria-label={'حذف ستون ' + (index + 1)} disabled={step.columns.length === 1} onClick={() => onChange({ ...step, columns: step.columns.filter(c => c.id !== column.id) })}>×</button></div>
        <ExtractEditor label={'ستون ' + (index + 1)} value={column} canPick={canPick && !!step.rowSelector} onChange={value => onChange({ ...step, columns: step.columns.map(c => c.id === column.id ? { ...column, ...value } : c) })} choose={() => pick({ kind: 'column', rowSelector: step.rowSelector }, selector => onChange({ ...step, columns: step.columns.map(c => c.id === column.id ? { ...c, selector } : c) }))} />
      </section>)}
      <details className="advanced-options"><summary>جدول خالی و محدودیت ردیف‌ها</summary><div className="form-grid"><label>اگر جدول خالی بود<select aria-label="جدول خالی" value={step.empty} onChange={e => onChange({ ...step, empty: e.target.value as 'allow' | 'error' })}><option value="error">توقف با خطا</option><option value="allow">خروجی آرایه خالی []</option></select></label><label>حداکثر ردیف<input aria-label="حداکثر ردیف" type="number" min={1} max={10000} value={step.maxRows} onChange={e => onChange({ ...step, maxRows: Number(e.target.value) })} /></label></div></details>
    </>}
    <AdvancedOptions step={step} onChange={onChange} />
  </fieldset>
}
