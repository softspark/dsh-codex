import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  AppServerClient,
  AppServerRpcError,
  AppServerTimeoutError,
} from '../../src/app-server/client.js'
import { AppServerProtocolError } from '../../src/app-server/validation.js'
import type { ExperimentalStartThreadOptions } from '../../src/app-server/types.js'
import {
  chatGptAccountResult,
  initializeResult,
  modelListResult,
} from '../fixtures/app-server-messages.js'
import { FakeTransport } from '../helpers/fake-transport.js'

class FailingReplyTransport extends FakeTransport {
  failReplies = false

  override async send(line: string): Promise<void> {
    if (this.failReplies) throw new Error('simulated reply write failure')
    await super.send(line)
  }
}

async function flushMicrotasks(): Promise<void> {
  for (let index = 0; index < 5; index += 1) await Promise.resolve()
}

async function startClient(
  transport: FakeTransport,
  options: ConstructorParameters<typeof AppServerClient>[0] = {},
): Promise<AppServerClient> {
  const client = new AppServerClient({ transport, ...options })
  const experimentalApi = (
    options as { readonly experimentalApi?: boolean }
  ).experimentalApi ?? false
  const started = client.start()
  await flushMicrotasks()
  expect(transport.messageAt(0)).toEqual({
    id: 1,
    method: 'initialize',
    params: {
      clientInfo: {
        name: 'softspark_dsh_codex',
        title: 'SoftSpark DSH Codex',
        version: '1.0.0',
      },
      capabilities: { experimentalApi, requestAttestation: false },
    },
  })
  transport.emitMessage({ id: 1, result: initializeResult })
  await expect(started).resolves.toEqual(initializeResult)
  expect(transport.messageAt(1)).toEqual({ method: 'initialized' })
  return client
}

describe('AppServerClient', () => {
  beforeEach(() => {
    vi.useRealTimers()
  })

  it('sends initialize before the initialized notification', async () => {
    const transport = new FakeTransport()

    const client = await startClient(transport)

    expect(transport.messages().map((message) => (message as { method: string }).method)).toEqual([
      'initialize',
      'initialized',
    ])
    await client.close()
  })

  it('opts into the experimental app-server API only when explicitly enabled', async () => {
    const transport = new FakeTransport()
    const options = { experimentalApi: true } as ConstructorParameters<
      typeof AppServerClient
    >[0]

    const client = await startClient(transport, options)

    expect(transport.messageAt(0)).toMatchObject({
      method: 'initialize',
      params: {
        capabilities: {
          experimentalApi: true,
          requestAttestation: false,
        },
      },
    })
    await client.close()
  })

  it('correlates out-of-order responses and ignores unknown response ids', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const first = client.request('test/first', { value: 1 })
    const second = client.request('test/second', { value: 2 })
    await flushMicrotasks()

    transport.emitMessage({ id: 99_999, result: { ignored: true } })
    transport.emitMessage({ id: 3, result: { order: 'second' } })
    await expect(second).resolves.toEqual({ order: 'second' })
    transport.emitMessage({ id: 2, result: { order: 'first' } })
    await expect(first).resolves.toEqual({ order: 'first' })
    await client.close()
  })

  it('parses account state and paginates the model catalog', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const account = client.readAccount()
    await flushMicrotasks()
    transport.emitMessage({ id: 2, result: chatGptAccountResult })
    await expect(account).resolves.toMatchObject({ authenticated: true, kind: 'chatgpt' })

    const models = client.listModels({ includeHidden: true, pageSize: 1 })
    await flushMicrotasks()
    transport.emitMessage({
      id: 3,
      result: { ...modelListResult, nextCursor: 'cursor-2' },
    })
    await flushMicrotasks()
    expect(transport.messageAt(4)).toMatchObject({
      method: 'model/list',
      params: { cursor: 'cursor-2', includeHidden: true, limit: 1 },
    })
    transport.emitMessage({ id: 4, result: { data: [], nextCursor: null } })
    await expect(models).resolves.toHaveLength(1)
    await client.close()
  })

  it('maps notifications, thread lifecycle and turn lifecycle to exact RPC payloads', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)

    await client.notify('client/ready', { ready: true })
    expect(transport.messageAt(2)).toEqual({
      method: 'client/ready',
      params: { ready: true },
    })

    const startedThread = client.startThread({
      model: 'gpt-test',
      cwd: '/workspace',
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      baseInstructions: 'system',
      developerInstructions: 'developer',
      ephemeral: true,
    })
    await flushMicrotasks()
    expect(transport.messageAt(3)).toEqual({
      id: 2,
      method: 'thread/start',
      params: {
        model: 'gpt-test',
        cwd: '/workspace',
        sandbox: 'workspace-write',
        approvalPolicy: 'untrusted',
        baseInstructions: 'system',
        developerInstructions: 'developer',
        ephemeral: true,
      },
    })
    transport.emitMessage({ id: 2, result: { thread: { id: 'thread-new' } } })
    await expect(startedThread).resolves.toEqual({ id: 'thread-new' })

    const resumedThread = client.resumeThread({ threadId: 'thread-existing' })
    await flushMicrotasks()
    expect(transport.messageAt(4)).toEqual({
      id: 3,
      method: 'thread/resume',
      params: { threadId: 'thread-existing' },
    })
    transport.emitMessage({ id: 3, result: { thread: { id: 'thread-existing' } } })
    await expect(resumedThread).resolves.toEqual({ id: 'thread-existing' })

    const startedTurn = client.startTurn({
      threadId: 'thread-existing',
      input: [{ type: 'text', text: 'hello' }],
      model: 'gpt-test',
      effort: 'high',
    })
    await flushMicrotasks()
    expect(transport.messageAt(5)).toEqual({
      id: 4,
      method: 'turn/start',
      params: {
        threadId: 'thread-existing',
        input: [{ type: 'text', text: 'hello' }],
        model: 'gpt-test',
        effort: 'high',
      },
    })
    transport.emitMessage({
      id: 4,
      result: {
        turn: { id: 'turn-1', status: 'inProgress', items: [], error: null },
      },
    })
    await expect(startedTurn).resolves.toMatchObject({ id: 'turn-1', status: 'inProgress' })

    const interrupted = client.interruptTurn({
      threadId: 'thread-existing',
      turnId: 'turn-1',
    })
    await flushMicrotasks()
    expect(transport.messageAt(6)).toEqual({
      id: 5,
      method: 'turn/interrupt',
      params: { threadId: 'thread-existing', turnId: 'turn-1' },
    })
    transport.emitMessage({ id: 5, result: {} })
    await expect(interrupted).resolves.toBeUndefined()
    await client.close()
  })

  it('maps dynamic tool definitions to the experimental thread/start payload exactly', async () => {
    const transport = new FakeTransport()
    const options = { experimentalApi: true } as ConstructorParameters<
      typeof AppServerClient
    >[0]
    const client = await startClient(transport, options)
    const dynamicTools = [{
      type: 'function' as const,
      name: 'delegate_claude',
      description: 'Delegate a coding task to Claude.',
      inputSchema: {
        type: 'object',
        properties: {
          task: { type: 'string' },
        },
        required: ['task'],
        additionalProperties: false,
      },
    }]
    const threadOptions: ExperimentalStartThreadOptions = {
      model: 'gpt-test',
      cwd: '/workspace',
      dynamicTools,
    }
    const startedThread = client.startThread(threadOptions)
    await flushMicrotasks()

    expect(transport.messageAt(2)).toEqual({
      id: 2,
      method: 'thread/start',
      params: {
        model: 'gpt-test',
        cwd: '/workspace',
        dynamicTools,
      },
    })
    transport.emitMessage({ id: 2, result: { thread: { id: 'thread-tools' } } })
    await expect(startedThread).resolves.toEqual({ id: 'thread-tools' })
    await client.close()
  })

  it('publishes notifications until unsubscribe and rejects subscriptions after close', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const listener = vi.fn()
    const unsubscribe = client.onNotification(listener)

    transport.emitMessage({ method: 'thread/started', params: { threadId: 'thread-1' } })
    expect(listener).toHaveBeenCalledWith({
      method: 'thread/started',
      params: { threadId: 'thread-1' },
    })
    unsubscribe()
    transport.emitMessage({ method: 'thread/closed', params: { threadId: 'thread-1' } })
    expect(listener).toHaveBeenCalledOnce()

    await client.close()
    expect(() => client.onNotification(listener)).toThrow(/client is closed/u)
  })

  it('registers at most one server-request handler and releases it with its disposer', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const handler = vi.fn(async () => ({ decision: 'cancel' as const }))
    const unregister = client.registerServerRequestHandler(handler)

    expect(() => client.registerServerRequestHandler(handler)).toThrow(
      /already registered/u,
    )
    transport.emitMessage({ id: 'registered-1', method: 'approval/request', params: {} })
    await flushMicrotasks()
    expect(handler).toHaveBeenCalledOnce()
    expect(transport.messages()).toContainEqual({
      id: 'registered-1',
      result: { decision: 'cancel' },
    })

    unregister()
    transport.emitMessage({ id: 'registered-2', method: 'approval/request', params: {} })
    await flushMicrotasks()
    expect(handler).toHaveBeenCalledOnce()
    expect(transport.messages()).toContainEqual({
      id: 'registered-2',
      error: { code: -32601, message: 'Server request is not supported' },
    })
    await client.close()
  })

  it('rejects repeated model cursors', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const models = client.listModels()
    await flushMicrotasks()
    transport.emitMessage({ id: 2, result: { ...modelListResult, nextCursor: 'repeat' } })
    await flushMicrotasks()
    transport.emitMessage({ id: 3, result: { data: [], nextCursor: 'repeat' } })

    await expect(models).rejects.toThrow(/repeated cursor/u)
    await client.close()
  })

  it('times out deterministically', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    const client = await startClient(transport, { requestTimeoutMs: 50 })

    const pending = client.request('test/slow')
    await flushMicrotasks()
    const rejection = expect(pending).rejects.toBeInstanceOf(AppServerTimeoutError)
    await vi.advanceTimersByTimeAsync(50)

    await rejection
    await client.close()
  })

  it('rejects an aborted request and discards its later response', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const controller = new AbortController()
    const pending = client.request('test/abort', {}, { signal: controller.signal })
    await flushMicrotasks()

    controller.abort()

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' })
    transport.emitMessage({ id: 2, result: { tooLate: true } })
    await client.close()
  })

  it('surfaces a redacted RPC error with its code', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const pending = client.request('test/error')
    await flushMicrotasks()

    transport.emitMessage({
      id: 2,
      error: { code: -32_000, message: 'Bearer raw-secret-token' },
    })

    const failure = await pending.catch((error: unknown) => error)
    expect(failure).toBeInstanceOf(AppServerRpcError)
    expect(failure).toMatchObject({ code: -32_000, message: 'Bearer [REDACTED]' })
    await client.close()
  })

  it('fails closed when a malformed line arrives', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const pending = client.request('test/pending')
    await flushMicrotasks()

    transport.emitLine('{not-json')

    await expect(pending).rejects.toBeInstanceOf(AppServerProtocolError)
    await flushMicrotasks()
    expect(transport.closed).toBe(true)
  })

  it('fails closed for unsupported server requests', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)

    transport.emitMessage({ id: 'server-1', method: 'unknown/request', params: {} })
    await flushMicrotasks()

    expect(transport.messages()).toContainEqual({
      id: 'server-1',
      error: { code: -32601, message: 'Server request is not supported' },
    })
    await client.close()
  })

  it('returns JSON from an explicitly registered server-request handler', async () => {
    const transport = new FakeTransport()
    const handler = vi.fn(async () => ({ decision: 'decline' as const }))
    const client = await startClient(transport, { serverRequestHandler: handler })

    transport.emitMessage({
      id: 'approval-1',
      method: 'item/commandExecution/requestApproval',
      params: { command: ['npm', 'test'] },
    })
    await flushMicrotasks()

    expect(handler).toHaveBeenCalledOnce()
    expect(transport.messages()).toContainEqual({
      id: 'approval-1',
      result: { decision: 'decline' },
    })
    await client.close()
  })

  it('times out and aborts a server-request handler that ignores its signal', async () => {
    vi.useFakeTimers()
    const transport = new FakeTransport()
    let handlerSignal: AbortSignal | undefined
    const handler = vi.fn((_request: unknown, signal: AbortSignal) => {
      handlerSignal = signal
      return new Promise<never>(() => {})
    })
    const client = await startClient(transport, {
      requestTimeoutMs: 50,
      serverRequestHandler: handler,
    })

    transport.emitMessage({
      id: 'server-timeout',
      method: 'item/commandExecution/requestApproval',
      params: { command: ['npm', 'test'] },
    })
    await flushMicrotasks()
    expect(handlerSignal?.aborted).toBe(false)
    await vi.advanceTimersByTimeAsync(50)
    await flushMicrotasks()

    expect(handlerSignal?.aborted).toBe(true)
    expect(transport.messages()).toContainEqual({
      id: 'server-timeout',
      error: {
        code: -32_000,
        message: 'Codex app-server server request timed out',
      },
    })
    await client.close()
  })

  it('closes cleanly when both a server-request result and its error reply fail to send', async () => {
    const transport = new FailingReplyTransport()
    const handler = vi.fn(async () => ({ decision: 'decline' as const }))
    const client = await startClient(transport, { serverRequestHandler: handler })
    const pending = client.request('test/pending')
    await flushMicrotasks()
    const pendingRejection = expect(pending).rejects.toThrow(
      /server-request response failed/u,
    )
    const unhandled: unknown[] = []
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason)
    }
    process.on('unhandledRejection', onUnhandled)

    try {
      transport.failReplies = true
      transport.emitMessage({
        id: 'approval-failure',
        method: 'item/commandExecution/requestApproval',
        params: { command: ['npm', 'test'] },
      })

      await vi.waitFor(() => expect(transport.closed).toBe(true))
      await pendingRejection
      await expect(client.close()).resolves.toBeUndefined()
      await new Promise<void>((resolve) => setImmediate(resolve))
      expect(unhandled).toEqual([])
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('rejects every pending request when closed', async () => {
    const transport = new FakeTransport()
    const client = await startClient(transport)
    const first = client.request('test/one')
    const second = client.request('test/two')
    await flushMicrotasks()

    await client.close()

    await expect(first).rejects.toThrow(/client closed/u)
    await expect(second).rejects.toThrow(/client closed/u)
  })
})
