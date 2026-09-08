import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import { reportRejectedToolCall } from '../src/index.js'

describe('reportRejectedToolCall', () => {
  it('writes the reason to the sink, not only to the logger', () => {
    const warn = vi.fn()
    const write = vi.fn()

    reportRejectedToolCall(
      { warn },
      { code: 'DYNAMIC_TOOL_UNKNOWN', message: 'no such tool', tool: 'browser_open' },
      write,
    )

    expect(write).toHaveBeenCalledWith(
      'dsh-codex: dynamic tool call refused: DYNAMIC_TOOL_UNKNOWN (browser_open) — no such tool\n',
    )
    expect(warn).toHaveBeenCalledOnce()
  })

  it('omits the parenthesis when the refusal names no tool', () => {
    const write = vi.fn()

    reportRejectedToolCall(
      { warn: vi.fn() },
      { code: 'DYNAMIC_TOOL_STATE_LOST', message: 'turn is no longer live' },
      write,
    )

    expect(write).toHaveBeenCalledWith(
      'dsh-codex: dynamic tool call refused: DYNAMIC_TOOL_STATE_LOST — turn is no longer live\n',
    )
  })

  // The regression this function exists for. A Cordis logger dispatches to
  // registered exporters and drops the message when the map is empty, and no
  // host-plane harness package registers one — so between 1.0.0 and 1.6.0 every
  // refusal reason was written into nothing while the code claimed otherwise.
  it('still reports when the Cordis logger has no exporter to dispatch to', () => {
    const ctx = new Context()
    const logger = ctx.logger('dsh-codex-test')
    const write = vi.fn()

    reportRejectedToolCall(
      logger,
      { code: 'DYNAMIC_TOOL_RESULT_TOO_LARGE', message: 'over the byte bound' },
      write,
    )

    expect(write).toHaveBeenCalledOnce()
    expect(write.mock.calls[0]?.[0]).toContain('DYNAMIC_TOOL_RESULT_TOO_LARGE')
  })

  it('defaults to stderr, which is what reaches a container log', () => {
    const stderr = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    try {
      reportRejectedToolCall(
        { warn: vi.fn() },
        { code: 'DYNAMIC_TOOL_NAMESPACE_UNSUPPORTED', message: 'namespaced call' },
      )
      expect(stderr).toHaveBeenCalledWith(
        expect.stringContaining('DYNAMIC_TOOL_NAMESPACE_UNSUPPORTED'),
      )
    } finally {
      stderr.mockRestore()
    }
  })
})
