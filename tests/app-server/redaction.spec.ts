import { describe, expect, it } from 'vitest'

import {
  redactJsonValue,
  redactSensitive,
  safeErrorMessage,
} from '../../src/app-server/redaction.js'
import { parseJsonRpcResponse } from '../../src/app-server/validation.js'

describe('error and token redaction', () => {
  it.each([
    ['Bearer abc.def-123', 'Bearer [REDACTED]'],
    ['api_key=sk-abcdefghijklmnopqrstuvwxyz', 'api_key=[REDACTED]'],
    ['password: hunter2', 'password: [REDACTED]'],
    ['refresh-token=refresh-secret-value', 'refresh-token=[REDACTED]'],
    ['token sk-abcdefghijklmnopqrstuvwxyz leaked', 'token [REDACTED] leaked'],
    [
      'jwt eyJ12345678.abcdefghijk.lmnopqrstuv leaked',
      'jwt [REDACTED] leaked',
    ],
  ])('redacts %s', (input, expected) => {
    expect(redactSensitive(input)).toBe(expected)
  })

  it('redacts nested sensitive keys, arrays and secret-like strings', () => {
    const value = {
      safe: 'visible',
      accessToken: 'access-secret',
      nested: {
        Authorization: 'Bearer raw-token',
        values: ['sk-abcdefghijklmnopqrstuvwxyz', { cookie: 'session-secret' }],
      },
    }

    expect(redactJsonValue(value)).toEqual({
      safe: 'visible',
      accessToken: '[REDACTED]',
      nested: {
        Authorization: '[REDACTED]',
        values: ['[REDACTED]', { cookie: '[REDACTED]' }],
      },
    })
  })

  it('redacts errors without stringifying unknown attacker-controlled objects', () => {
    expect(safeErrorMessage(new Error('Bearer raw-token'))).toBe('Bearer [REDACTED]')
    expect(safeErrorMessage('apiKey=sk-abcdefghijklmnopqrstuvwxyz')).toBe(
      'apiKey=[REDACTED]',
    )
    expect(safeErrorMessage({ toString: () => 'sk-should-not-run' })).toBe(
      'Unknown app-server error',
    )
  })

  it('bounds redacted diagnostic length', () => {
    expect(redactSensitive('x'.repeat(3_000))).toHaveLength(2_000)
  })

  it('redacts JSON-RPC error messages and nested error data', () => {
    const response = parseJsonRpcResponse({
      id: 1,
      error: {
        code: -32_000,
        message: 'Bearer raw-token',
        data: {
          safe: 'visible',
          accessToken: 'access-secret',
          nested: { authorization: 'Bearer second-token' },
        },
      },
    })

    expect(response).toEqual({
      id: 1,
      error: {
        code: -32_000,
        message: 'Bearer [REDACTED]',
        data: {
          safe: 'visible',
          accessToken: '[REDACTED]',
          nested: { authorization: '[REDACTED]' },
        },
      },
    })
  })
})
