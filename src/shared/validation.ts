import type { AppSettings, JsonValue, RunRequest } from './types'

export class ValidationError extends Error {}
export class QueueFullError extends Error {}

export function assertJson(value: unknown, seen = new Set<object>(), depth = 0): asserts value is JsonValue {
  if (depth > 100) throw new ValidationError('JSON nesting exceeds 100 levels.')
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return
  if (typeof value === 'number' && Number.isFinite(value)) return
  if (typeof value !== 'object' || seen.has(value)) throw new ValidationError('Value must be finite, acyclic JSON.')
  if (!Array.isArray(value) && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new ValidationError('Only plain JSON objects are supported.')
  }
  seen.add(value)
  for (const item of Array.isArray(value) ? value : Object.values(value)) assertJson(item, seen, depth + 1)
  seen.delete(value)
}

export function validateTimeout(value: unknown): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1000 || (value as number) > 3_600_000) {
    throw new ValidationError('Timeout must be an integer from 1000 to 3600000 ms.')
  }
}

export function validateRunRequest(value: unknown = {}): RunRequest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ValidationError('Expected { input, timeoutMs? }.')
  const request = value as Record<string, unknown>
  if (Object.keys(request).some(key => !['input', 'timeoutMs'].includes(key))) throw new ValidationError('Unknown run request field.')
  if (request.timeoutMs !== undefined) validateTimeout(request.timeoutMs)
  const input = request.input === undefined ? {} : request.input
  assertJson(input)
  if (JSON.stringify(input).length > 500_000) throw new ValidationError('Input exceeds 500000 characters.')
  return { input: JSON.parse(JSON.stringify(input)), timeoutMs: request.timeoutMs as number | undefined }
}

export function validateSettings(value: AppSettings): AppSettings {
  if (!value || typeof value.apiEnabled !== 'boolean' || typeof value.host !== 'string' || !value.host.trim()) throw new ValidationError('Invalid API settings.')
  if (!Number.isInteger(value.port) || value.port < 1 || value.port > 65535) throw new ValidationError('Port must be 1–65535.')
  if (!Number.isInteger(value.concurrency) || value.concurrency < 1 || value.concurrency > 20) throw new ValidationError('Concurrency must be 1–20.')
  validateTimeout(value.runTimeoutMs)
  if (typeof value.token !== 'string' || value.token.trim().length < 16 || /\s/.test(value.token)) throw new ValidationError('Token must have at least 16 characters and no whitespace.')
  const retryCount = value.retryCount ?? 1
  if (!Number.isInteger(retryCount) || retryCount < 0 || retryCount > 5) throw new ValidationError('Retry count must be 0–5.')
  return { retryCount, notifyOnFailure: value.notifyOnFailure !== false, apiEnabled: value.apiEnabled, host: value.host.trim(), port: value.port, token: value.token, concurrency: value.concurrency, runTimeoutMs: value.runTimeoutMs }
}
