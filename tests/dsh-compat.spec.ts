import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { describe, expect, it } from 'vitest'

import { sessionEvents, toolCallId } from '../src/dsh-compat.js'
import { resolveSessionPermissions } from '../src/session-permissions.js'

declare module '@deepseek-ai/dsh-session' {
  interface SessionEventMap {
    'approval/policy': { policy: 'ask' | 'never' }
  }
}

describe('supported DSH contracts', () => {
  it('preserves tool-call correlation without a version-specific constructor', () => {
    expect(toolCallId('call-123')).toBe('call-123')
  })

  it('accepts the old events getter and prefers the new snapshot API', () => {
    expect(sessionEvents(undefined)).toBeUndefined()
    expect(sessionEvents({ events: ['old'] })).toEqual(['old'])
    expect(sessionEvents({ events: ['old'], snapshotEvents: () => ['new'] })).toEqual(['new'])
  })

  it('reads real DSH sessions and preserves their newest approval override', () => {
    const session = Session.create(SessionId('permissions-test'))
    session.append('approval/policy', { policy: 'never' })
    session.append('approval/policy', { policy: 'ask' })
    const fallback = { sandbox: 'workspace-write', approvalPolicy: 'untrusted' } as const

    expect(resolveSessionPermissions(fallback, sessionEvents(session))).toEqual(fallback)
    expect(sessionEvents(session)).toHaveLength(2)
  })
})
