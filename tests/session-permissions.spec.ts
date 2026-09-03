import { describe, expect, it } from 'vitest'

import { resolveSessionPermissions } from '../src/session-permissions.js'

const FALLBACK = {
  sandbox: 'workspace-write',
  approvalPolicy: 'untrusted',
} as const

function events(
  ...items: ReadonlyArray<{ readonly type: string; readonly data: unknown }>
): readonly unknown[] {
  return items.map((item, index) => ({
    seq: index,
    time: index,
    type: item.type,
    data: item.data,
  }))
}

describe('resolveSessionPermissions', () => {
  it('keeps the static fallback without explicit session events', () => {
    expect(resolveSessionPermissions(FALLBACK, undefined)).toBe(FALLBACK)
    expect(resolveSessionPermissions(FALLBACK, events(
      { type: 'user/message', data: {} },
    ))).toBe(FALLBACK)
  })

  it('maps the Full preset events to Codex full access without approvals', () => {
    expect(resolveSessionPermissions(FALLBACK, events(
      { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
      { type: 'approval/policy', data: { policy: 'never' } },
    ))).toEqual({
      sandbox: 'danger-full-access',
      approvalPolicy: 'never',
    })
  })

  it('uses the newest sandbox and approval overrides', () => {
    expect(resolveSessionPermissions(FALLBACK, events(
      { type: 'sandbox/mode', data: { mode: 'danger-full-access' } },
      { type: 'approval/policy', data: { policy: 'never' } },
      { type: 'sandbox/mode', data: { mode: 'read-only' } },
    ))).toEqual({
      sandbox: 'read-only',
      approvalPolicy: 'never',
    })
  })

  it('does not translate DSH ask into an unsupported approval path', () => {
    expect(resolveSessionPermissions(FALLBACK, events(
      { type: 'approval/policy', data: { policy: 'ask' } },
    ))).toBe(FALLBACK)
  })

  it('ignores malformed extension events', () => {
    expect(resolveSessionPermissions(FALLBACK, events(
      { type: 'sandbox/mode', data: { mode: 'unconfined' } },
      { type: 'approval/policy', data: { policy: 'allow' } },
    ))).toBe(FALLBACK)
  })
})
