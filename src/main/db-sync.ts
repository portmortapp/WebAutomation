import { app, safeStorage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import type { DbConfig, DbStatus, DbType } from '../shared/types'

// Optional SQL mirror. Local JSON files stay the working copy (the store is synchronous);
// every write to a mirrored file is queued to the database. If the DB is down, files keep working.
const DATA_DIR = path.join(app.getPath('userData'), 'flowweb')
const CONFIG_FILE = path.join(DATA_DIR, 'db.json')
const MIRRORED = [/^scenarios\.json$/, /^runs\/[^/]+\/result\.json$/]

/* eslint-disable @typescript-eslint/no-explicit-any */
interface Adapter { query(sql: string, params?: unknown[]): Promise<any[]>; close(): Promise<void> }

const defaults: DbConfig = { enabled: false, type: 'postgres', host: 'localhost', port: 5432, database: 'flowweb', user: '', password: '', ssl: false }
export const defaultPort = (type: DbType) => type === 'postgres' ? 5432 : type === 'mssql' ? 1433 : 3306

let adapter: Adapter | null = null
let config: DbConfig = { ...defaults }
let status: DbStatus = { state: 'off', type: 'postgres', pending: 0 }
const queue = new Map<string, string | null>()
let flushing = false
let wanted: DbConfig | null = null
let timer: NodeJS.Timeout | null = null
let attempt = 0
const TOMB_FILE = path.join(DATA_DIR, 'db-pending-deletes.json')
const RETRY_FIRST_MS = 15_000
const RETRY_NEXT_MS = 30_000

// Deletions made while the DB is unreachable must survive a restart, otherwise the next pull would resurrect them.
function loadTomb(): Set<string> {
  try { return new Set(JSON.parse(fs.readFileSync(TOMB_FILE, 'utf8')) as string[]) } catch { return new Set() }
}
function saveTomb(keys: Set<string>) {
  try {
    if (!keys.size) { fs.rmSync(TOMB_FILE, { force: true }); return }
    fs.mkdirSync(DATA_DIR, { recursive: true })
    fs.writeFileSync(TOMB_FILE, JSON.stringify([...keys]), { mode: 0o600 })
  } catch (error) { console.error('Could not save pending DB deletions:', error) }
}

function cancelReconnect() { if (timer) clearTimeout(timer); timer = null; attempt = 0 }
function scheduleReconnect() {
  if (timer || !wanted?.enabled) return
  const delay = attempt === 0 ? RETRY_FIRST_MS : RETRY_NEXT_MS
  attempt++
  timer = setTimeout(async () => {
    timer = null
    const target = wanted
    if (!target?.enabled || adapter) return
    try {
      await connectWith(target, true)
      attempt = 0
      void flush()
    } catch (error) {
      status = { state: 'error', type: target.type, pending: queue.size, error: message(error) }
      scheduleReconnect()
    }
  }, delay)
  timer.unref?.()
}

function loadConfig(): DbConfig {
  try {
    const raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) as { enc: boolean; data: string }
    const plain = raw.enc ? safeStorage.decryptString(Buffer.from(raw.data, 'base64')) : raw.data
    return { ...defaults, ...JSON.parse(plain) }
  } catch { return { ...defaults } }
}

function saveConfig(value: DbConfig) {
  fs.mkdirSync(DATA_DIR, { recursive: true })
  const plain = JSON.stringify(value)
  const enc = safeStorage?.isEncryptionAvailable?.() === true
  const data = enc ? safeStorage.encryptString(plain).toString('base64') : plain
  const tmp = `${CONFIG_FILE}.${crypto.randomUUID()}.tmp`
  fs.writeFileSync(tmp, JSON.stringify({ enc, data }), { mode: 0o600 })
  fs.renameSync(tmp, CONFIG_FILE)
}

export function publicConfig(): DbConfig { return { ...loadConfig(), password: '' } }
export function getDbStatus(): DbStatus { return { ...status, pending: queue.size } }

function validate(input: DbConfig): DbConfig {
  const type = (['postgres', 'mssql', 'mysql'] as const).includes(input.type) ? input.type : 'postgres'
  const port = Number(input.port) || defaultPort(type)
  if (port < 1 || port > 65535) throw new Error('پورت نامعتبر است')
  const host = String(input.host ?? '').trim()
  const database = String(input.database ?? '').trim()
  if (!host || !database) throw new Error('آدرس سرور و نام پایگاه داده الزامی است')
  if (host.length > 255 || database.length > 128) throw new Error('مقدار بیش از حد طولانی است')
  return { enabled: !!input.enabled, type, host, port, database, user: String(input.user ?? '').slice(0, 128), password: String(input.password ?? '').slice(0, 512), ssl: !!input.ssl }
}

async function open(c: DbConfig): Promise<Adapter> {
  const timeout = 8000
  if (c.type === 'postgres') {
    const { Client } = require('pg')
    const client = new Client({ host: c.host, port: c.port, database: c.database, user: c.user, password: c.password, ssl: c.ssl ? { rejectUnauthorized: false } : false, connectionTimeoutMillis: timeout })
    await client.connect()
    return {
      query: async (sql, params = []) => (await client.query(sql.replace(/\?/g, (() => { let i = 0; return () => '$' + ++i })()), params)).rows,
      close: () => client.end()
    }
  }
  if (c.type === 'mysql') {
    const mysql = require('mysql2/promise')
    const conn = await mysql.createConnection({ host: c.host, port: c.port, database: c.database, user: c.user, password: c.password, ssl: c.ssl ? { rejectUnauthorized: false } : undefined, connectTimeout: timeout })
    return { query: async (sql, params = []) => { const [rows] = await conn.query(sql, params); return Array.isArray(rows) ? rows : [] }, close: () => conn.end() }
  }
  const mssql = require('mssql')
  const pool = await new mssql.ConnectionPool({ server: c.host, port: c.port, database: c.database, user: c.user, password: c.password, connectionTimeout: timeout, options: { encrypt: c.ssl, trustServerCertificate: true } }).connect()
  return {
    query: async (sql, params = []) => {
      const request = pool.request()
      let i = 0
      const text = sql.replace(/\?/g, () => '@p' + i++)
      params.forEach((value, index) => request.input('p' + index, value))
      return (await request.query(text)).recordset ?? []
    },
    close: () => pool.close()
  }
}

// Versioned migrations, applied in order and recorded in flowweb_migrations.
function migrations(type: DbType): { version: number; name: string; sql: string[] }[] {
  const text = type === 'mssql' ? 'NVARCHAR(MAX)' : type === 'mysql' ? 'LONGTEXT' : 'TEXT'
  const key = type === 'mssql' ? 'NVARCHAR(400)' : 'VARCHAR(400)'
  const ts = type === 'mssql' ? 'DATETIME2' : type === 'mysql' ? 'DATETIME' : 'TIMESTAMP'
  return [
    { version: 1, name: 'documents', sql: [`CREATE TABLE flowweb_documents (doc_key ${key} NOT NULL PRIMARY KEY, body ${text} NOT NULL, updated_at ${ts} NOT NULL)`] },
    { version: 2, name: 'documents_updated_index', sql: ['CREATE INDEX ix_flowweb_documents_updated ON flowweb_documents (updated_at)'] }
  ]
}

async function migrate(db: Adapter, type: DbType): Promise<number> {
  const ts = type === 'mssql' ? 'DATETIME2' : type === 'mysql' ? 'DATETIME' : 'TIMESTAMP'
  const exists = type === 'mssql' ? "IF OBJECT_ID('flowweb_migrations') IS NULL " : ''
  const ifNot = type === 'mssql' ? '' : 'IF NOT EXISTS '
  await db.query(`${exists}CREATE TABLE ${ifNot}flowweb_migrations (version INT NOT NULL PRIMARY KEY, name VARCHAR(100) NOT NULL, applied_at ${ts} NOT NULL)`)
  const done = new Set((await db.query('SELECT version FROM flowweb_migrations')).map(r => Number(r.version)))
  let applied = 0
  for (const m of migrations(type)) {
    if (done.has(m.version)) continue
    for (const statement of m.sql) await db.query(statement)
    await db.query('INSERT INTO flowweb_migrations (version, name, applied_at) VALUES (?, ?, ?)', [m.version, m.name, new Date()])
    applied++
  }
  return applied
}

async function upsert(db: Adapter, type: DbType, key: string, body: string) {
  const now = new Date()
  if (type === 'postgres') return db.query('INSERT INTO flowweb_documents (doc_key, body, updated_at) VALUES (?, ?, ?) ON CONFLICT (doc_key) DO UPDATE SET body = EXCLUDED.body, updated_at = EXCLUDED.updated_at', [key, body, now])
  if (type === 'mysql') return db.query('INSERT INTO flowweb_documents (doc_key, body, updated_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE body = VALUES(body), updated_at = VALUES(updated_at)', [key, body, now])
  await db.query('UPDATE flowweb_documents SET body = ?, updated_at = ? WHERE doc_key = ?', [body, now, key])
  await db.query('INSERT INTO flowweb_documents (doc_key, body, updated_at) SELECT ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM flowweb_documents WHERE doc_key = ?)', [key, body, now, key])
}

const relKey = (file: string) => path.relative(DATA_DIR, file).split(path.sep).join('/')
const writeLocal = (key: string, body: string) => {
  const file = path.join(DATA_DIR, ...key.split('/'))
  if (!file.startsWith(DATA_DIR + path.sep)) return
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, body, { mode: 0o600 })
}

function localDocuments(): Map<string, string> {
  const out = new Map<string, string>()
  const scenarios = path.join(DATA_DIR, 'scenarios.json')
  if (fs.existsSync(scenarios)) out.set('scenarios.json', fs.readFileSync(scenarios, 'utf8'))
  const runs = path.join(DATA_DIR, 'runs')
  if (fs.existsSync(runs)) for (const id of fs.readdirSync(runs)) {
    const file = path.join(runs, id, 'result.json')
    if (fs.existsSync(file)) out.set(`runs/${id}/result.json`, fs.readFileSync(file, 'utf8'))
  }
  return out
}

// Called by the store after a mirrored file/folder is removed.
export function mirrorDelete(target: string) {
  try {
    const key = relKey(target)
    const m = /^runs\/([^/]+)(?:\/result\.json)?$/.exec(key)
    if (!m) return
    const docKey = `runs/${m[1]}/result.json`
    const tomb = loadTomb(); tomb.add(docKey); saveTomb(tomb)
    queue.set(docKey, null)
    void flush()
  } catch (error) { console.error('DB delete mirror failed:', error) }
}

// Called by the store after every atomic write. Never throws and never blocks.
export function mirror(file: string, value: unknown) {
  if (!adapter) return
  const key = relKey(file)
  if (!MIRRORED.some(p => p.test(key))) return
  const tomb = loadTomb()
  if (tomb.delete(key)) saveTomb(tomb)
  queue.set(key, JSON.stringify(value, null, 2))
  void flush()
}

async function flush() {
  if (flushing || !adapter) return
  flushing = true
  try {
    while (queue.size && adapter) {
      const [key, body] = queue.entries().next().value as [string, string | null]
      if (body === null) {
        await adapter.query('DELETE FROM flowweb_documents WHERE doc_key = ?', [key])
        if (queue.get(key) === null) { queue.delete(key); const tomb = loadTomb(); if (tomb.delete(key)) saveTomb(tomb) }
      } else {
        await upsert(adapter, config.type, key, body)
        if (queue.get(key) === body) queue.delete(key)
      }
      status = { ...status, lastSync: new Date().toISOString(), error: undefined }
    }
  } catch (error) {
    status = { ...status, state: 'error', error: String((error as Error).message ?? error) }
    await closeAdapter()
    scheduleReconnect()
  } finally { flushing = false }
}

async function closeAdapter() {
  const old = adapter
  adapter = null
  try { await old?.close() } catch { /* ignore */ }
}

async function connectWith(c: DbConfig, reconnect = false): Promise<{ migrated: number; source: 'database' | 'local' }> {
  await closeAdapter()
  status = { state: 'connecting', type: c.type, pending: 0 }
  const db = await open(c)
  try {
    const migrated = await migrate(db, c.type)
    const rows = await db.query('SELECT doc_key, body FROM flowweb_documents')
    let source: 'database' | 'local' = 'local'
    // Apply deletions that were made while offline before anything is pulled back.
    const tomb = loadTomb()
    for (const key of tomb) await db.query('DELETE FROM flowweb_documents WHERE doc_key = ?', [key])
    saveTomb(new Set())
    const live = rows.filter(r => !tomb.has(String(r.doc_key)))
    if (reconnect) {
      // Local files were the working copy during the outage: push them, never overwrite them.
      for (const [key, body] of localDocuments()) await upsert(db, c.type, key, body)
    } else if (live.length) {
      source = 'database'
      for (const row of live) writeLocal(String(row.doc_key), String(row.body))
    } else {
      for (const [key, body] of localDocuments()) await upsert(db, c.type, key, body)
    }
    adapter = db
    config = c
    status = { state: 'connected', type: c.type, pending: 0, lastSync: new Date().toISOString(), migrated, source }
    return { migrated, source }
  } catch (error) { try { await db.close() } catch { /* ignore */ } throw error }
}

function message(error: unknown) { return String((error as Error)?.message ?? error) }

export async function testDb(input: DbConfig): Promise<{ ok: boolean; error?: string; ms?: number }> {
  const started = Date.now()
  try {
    const merged = validate({ ...input, password: input.password || loadConfig().password })
    const db = await open(merged)
    try { await db.query('SELECT 1') } finally { await db.close() }
    return { ok: true, ms: Date.now() - started }
  } catch (error) { return { ok: false, error: message(error) } }
}

export async function saveDb(input: DbConfig): Promise<DbStatus> {
  const old = loadConfig()
  const next = validate({ ...input, password: input.password || old.password })
  saveConfig(next)
  cancelReconnect()
  wanted = next.enabled ? next : null
  if (!next.enabled) { await closeAdapter(); queue.clear(); status = { state: 'off', type: next.type, pending: 0 }; return getDbStatus() }
  try { await connectWith(next) }
  catch (error) { status = { state: 'error', type: next.type, pending: 0, error: message(error) }; scheduleReconnect() }
  return getDbStatus()
}

export async function initDb() {
  const saved = loadConfig()
  status = { state: 'off', type: saved.type, pending: 0 }
  if (!saved.enabled) return
  wanted = saved
  try { await connectWith(saved) }
  catch (error) { status = { state: 'error', type: saved.type, pending: 0, error: message(error) }; scheduleReconnect() }
}

export async function closeDb() { cancelReconnect(); wanted = null; await flush(); await closeAdapter() }
