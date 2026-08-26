import { describe, expect, it } from 'vitest'

import {
  agentDeltaNotification,
  chatGptAccountResult,
  initializeResult,
  modelListResult,
  threadStartResult,
  turnCompletedNotification,
  turnStartResult,
} from '../fixtures/app-server-messages.js'
import {
  AppServerProtocolError,
  isJsonValue,
  parseAccountStatus,
  parseDeltaNotification,
  parseExperimentalDynamicToolCall,
  parseInitializeResult,
  parseJsonRpcResponse,
  parseModelPage,
  parseNotification,
  parseServerRequest,
  parseThread,
  parseTurn,
} from '../../src/app-server/validation.js'

describe('app-server protocol validation', () => {
  it('accepts finite recursive JSON values and rejects non-JSON values', () => {
    expect(isJsonValue({ ok: [null, true, 1, 'text'] })).toBe(true)
    expect(isJsonValue({ nested: Number.NaN })).toBe(false)
    expect(isJsonValue({ nested: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isJsonValue({ nested: undefined })).toBe(false)
  })

  it('parses the generated initialize response including required codexHome', () => {
    const result = parseInitializeResult(initializeResult)

    expect(result).toEqual(initializeResult)
  })

  it('rejects initialize responses that omit generated required codexHome', () => {
    const { codexHome: _codexHome, ...withoutCodexHome } = initializeResult

    expect(() => parseInitializeResult(withoutCodexHome)).toThrow(/codexHome/u)
  })

  it('parses authenticated and unauthenticated account states without exposing account data', () => {
    expect(parseAccountStatus(chatGptAccountResult)).toEqual({
      authenticated: true,
      kind: 'chatgpt',
      requiresOpenaiAuth: true,
    })
    expect(parseAccountStatus({ account: null, requiresOpenaiAuth: true })).toEqual({
      authenticated: false,
      requiresOpenaiAuth: true,
    })
  })

  it('keeps experimental account kinds outside the stable parser', () => {
    expect(() => parseAccountStatus({
      account: { type: 'chatgptAuthTokens', accessToken: 'secret' },
      requiresOpenaiAuth: true,
    })).toThrow(/unsupported/u)
  })

  it('parses the current generated model catalog', () => {
    const result = parseModelPage(modelListResult)

    expect(result.data).toHaveLength(1)
    expect(result.data[0]).toMatchObject({
      id: 'gpt-5.6-terra',
      inputModalities: ['text', 'image'],
      reasoningEfforts: [{ id: 'medium', description: 'Balanced' }],
    })
    expect(result.nextCursor).toBeNull()
  })

  it('falls back to text and image for older catalogs without inputModalities', () => {
    const model = { ...modelListResult.data[0] } as Record<string, unknown>
    delete model['inputModalities']

    const result = parseModelPage({ data: [model], nextCursor: null })

    expect(result.data[0]?.inputModalities).toEqual(['text', 'image'])
  })

  it('rejects malformed model pages', () => {
    expect(() => parseModelPage({ data: {}, nextCursor: null })).toThrow(/data/u)
    expect(() => parseModelPage({ data: [], nextCursor: 12 })).toThrow(/nextCursor/u)
  })

  it('parses thread and turn summaries', () => {
    expect(parseThread(threadStartResult)).toEqual({ id: 'thr_test_123' })
    expect(parseTurn(turnStartResult)).toEqual({
      id: 'turn_test_456',
      status: 'inProgress',
      items: [],
      error: null,
    })
  })

  it('rejects unsupported turn status', () => {
    expect(() => parseTurn({ turn: { id: 'turn_1', status: 'queued' } })).toThrow(
      /status is unsupported/u,
    )
  })

  it('parses agent, reasoning, completion and generic notifications', () => {
    expect(parseDeltaNotification(
      agentDeltaNotification.method,
      agentDeltaNotification.params,
    )).toEqual(agentDeltaNotification)
    expect(parseDeltaNotification('item/reasoning/summaryTextDelta', {
      ...agentDeltaNotification.params,
      summaryIndex: 0,
    })).toMatchObject({ params: { index: 0, delta: 'Hello' } })
    expect(parseDeltaNotification(
      turnCompletedNotification.method,
      turnCompletedNotification.params,
    )).toMatchObject({ params: { turn: { status: 'completed' } } })
    expect(parseNotification('thread/started', { thread: { id: 'thr_1' } }, 12)).toEqual({
      method: 'thread/started',
      params: { thread: { id: 'thr_1' } },
      emittedAtMs: 12,
    })
  })

  it('rejects malformed delta indexes and unsupported delta methods', () => {
    expect(() => parseDeltaNotification('item/reasoning/textDelta', {
      ...agentDeltaNotification.params,
      contentIndex: -1,
    })).toThrow(/non-negative integer/u)
    expect(() => parseDeltaNotification('experimental/delta', {})).toThrow(/unsupported/u)
  })

  it('parses server requests with safe numeric or string ids', () => {
    expect(parseServerRequest('approval-1', 'item/fileChange/requestApproval', {})).toEqual({
      id: 'approval-1',
      method: 'item/fileChange/requestApproval',
      params: {},
    })
    expect(parseServerRequest(7, 'attestation/generate', undefined)).toEqual({
      id: 7,
      method: 'attestation/generate',
    })
  })

  it.each([null, '', 1.5, Number.MAX_SAFE_INTEGER + 1, true])(
    'rejects malformed JSON-RPC id %p',
    (id) => {
      expect(() => parseJsonRpcResponse({ id, result: {} })).toThrow(AppServerProtocolError)
    },
  )

  it('accepts the omitted-on-wire and explicit JSON-RPC 2.0 forms', () => {
    expect(parseJsonRpcResponse({ id: 1, result: { ok: true } })).toEqual({
      id: 1,
      result: { ok: true },
    })
    expect(parseJsonRpcResponse({ jsonrpc: '2.0', id: 'one', result: null })).toEqual({
      id: 'one',
      result: null,
    })
  })

  it('rejects responses containing both or neither result and error', () => {
    expect(() => parseJsonRpcResponse({
      id: 1,
      result: {},
      error: { code: -1, message: 'failure' },
    })).toThrow(/exactly one/u)
    expect(() => parseJsonRpcResponse({ id: 1 })).toThrow(/exactly one/u)
  })

  it('parses experimental dynamic tool calls only through the dedicated parser', () => {
    expect(parseExperimentalDynamicToolCall({
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      namespace: null,
      tool: 'search',
      arguments: { query: 'safe' },
    })).toEqual({
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      namespace: null,
      tool: 'search',
      arguments: { query: 'safe' },
    })
    expect(() => parseExperimentalDynamicToolCall({
      threadId: 'thr_1',
      turnId: 'turn_1',
      callId: 'call_1',
      namespace: null,
      tool: 'search',
      arguments: { value: undefined },
    })).toThrow(/must be (?:a )?JSON/u)
  })
})
