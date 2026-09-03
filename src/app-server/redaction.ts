const MAX_ERROR_CHARS = 2_000

const KEY_VALUE_SECRET = /(["']?(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|cookie|password|secret)["']?\s*[:=]\s*)(["']?)[^\s,"'}&]+\2/giu
const BEARER_SECRET = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu
const OPENAI_SECRET = /\bsk-[A-Za-z0-9_-]{12,}\b/gu
const JWT_SECRET = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/gu
const SENSITIVE_KEY = /^(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|cookie|password|secret)$/iu

import type { JsonObject, JsonValue } from './types.js'

export function redactSensitive(value: string): string {
  return value
    .replace(KEY_VALUE_SECRET, '$1[REDACTED]')
    .replace(BEARER_SECRET, 'Bearer [REDACTED]')
    .replace(OPENAI_SECRET, '[REDACTED]')
    .replace(JWT_SECRET, '[REDACTED]')
    .slice(0, MAX_ERROR_CHARS)
}

/**
 * A redacted, human-readable account of a failure, prefixed with its stable
 * failure class when there is one.
 *
 * The class matters here because this string is the only thing the app-server
 * ever sees. Codex renders its own `dynamic tool request failed` regardless, so
 * whoever reads the wire — or a transcript — otherwise cannot tell a pending
 * call limit from a lost turn from an unknown tool. `HarnessError` carries the
 * class in `code`; nothing else does, so nothing else is prefixed.
 */
export function safeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    const code = (error as { readonly code?: unknown }).code
    const message = redactSensitive(error.message)
    return typeof code === 'string' && code.length > 0
      ? `[${code}] ${message}`
      : message
  }
  if (typeof error === 'string') return redactSensitive(error)
  return 'Unknown app-server error'
}

export function redactJsonValue(value: JsonValue, key?: string): JsonValue {
  if (key !== undefined && SENSITIVE_KEY.test(key)) return '[REDACTED]'
  if (typeof value === 'string') return redactSensitive(value)
  if (Array.isArray(value)) return value.map((entry) => redactJsonValue(entry))
  if (value === null || typeof value !== 'object') return value
  const redacted: Record<string, JsonValue> = {}
  for (const [entryKey, entryValue] of Object.entries(value)) {
    redacted[entryKey] = redactJsonValue(entryValue, entryKey)
  }
  return redacted as JsonObject
}
