import {
  CallId,
  LlmError,
  LlmRuntime,
  MessageId,
  type GenerateOptions,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'

import {
  CODEX_PROVIDER,
  MAX_DYNAMIC_TOOL_ARGUMENT_BYTES,
  MAX_DYNAMIC_TOOL_CATALOG_BYTES,
  MAX_DYNAMIC_TOOL_DESCRIPTION_BYTES,
  MAX_DYNAMIC_TOOL_NAME_BYTES,
  MAX_DYNAMIC_TOOL_RESULT_BYTES,
  MAX_DYNAMIC_TOOL_SCHEMA_BYTES,
  MAX_DYNAMIC_TOOLS,
  MAX_PENDING_DYNAMIC_TOOL_CALLS,
  CodexAdapter,
} from '../src/adapter.js'
import type { AppServerClient } from '../src/app-server/client.js'
import type {
  AppServerNotification,
  AppServerRequest,
  CodexAccountStatus,
  CodexModel,
  CodexTurn,
  JsonValue,
  ServerRequestHandler,
} from '../src/app-server/types.js'

type NotificationListener = (notification: AppServerNotification) => void

const TOOL = {
  name: 'delegate_claude',
  description: 'Delegate a coding task to Claude.',
  parameters: {
    type: 'object',
    properties: { task: { type: 'string' } },
    required: ['task'],
    additionalProperties: false,
  },
}

const MODEL: CodexModel = {
  id: 'model-id',
  model: 'gpt-test',
  displayName: 'GPT Test',
  description: 'Test model',
  hidden: false,
  isDefault: true,
  inputModalities: ['text'],
  reasoningEfforts: [],
  defaultReasoningEffort: 'medium',
}

const SECOND_MODEL: CodexModel = {
  ...MODEL,
  id: 'model-id-2',
  model: 'gpt-test-2',
  displayName: 'GPT Test 2',
  isDefault: false,
}

const MAX_DYNAMIC_TOOL_CALL_ID_BYTES = 256

function createFakeClient() {
  const listeners = new Set<NotificationListener>()
  let handler: ServerRequestHandler | undefined
  const client = {
    readAccount: vi.fn(async (): Promise<CodexAccountStatus> => ({
      authenticated: true,
      kind: 'chatgpt',
      requiresOpenaiAuth: true,
    })),
    listModels: vi.fn(async () => [MODEL, SECOND_MODEL] as readonly CodexModel[]),
    startThread: vi.fn(async () => ({ id: 'thread-tools' })),
    resumeThread: vi.fn(async (options: { readonly threadId: string }) => ({
      id: options.threadId,
    })),
    startTurn: vi.fn(async (): Promise<CodexTurn> => ({
      id: 'turn-tools',
      status: 'inProgress',
      items: [],
      error: null,
    })),
    interruptTurn: vi.fn(async () => undefined),
    onNotification: vi.fn((listener: NotificationListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    registerServerRequestHandler: vi.fn((candidate: ServerRequestHandler) => {
      if (handler !== undefined) throw new Error('handler already registered')
      handler = candidate
      return () => {
        if (handler === candidate) handler = undefined
      }
    }),
    close: vi.fn(async () => undefined),
  }

  return {
    client: client as unknown as AppServerClient,
    methods: client,
    emit(notification: AppServerNotification): void {
      for (const listener of listeners) listener(notification)
    },
    requestDynamicTool(
      callId: string,
      tool: string,
      argumentsValue: JsonValue,
      requestId: string = `rpc-${callId}`,
      signal: AbortSignal = new AbortController().signal,
    ): Promise<JsonValue> {
      if (handler === undefined) {
        return Promise.reject(new Error('dynamic-tool handler is not registered'))
      }
      const request: AppServerRequest = {
        id: requestId,
        method: 'item/tool/call',
        params: {
          threadId: 'thread-tools',
          turnId: 'turn-tools',
          callId,
          namespace: null,
          tool,
          arguments: argumentsValue,
        },
      }
      return handler(request, signal)
    },
    requestServer(
      request: AppServerRequest,
      signal: AbortSignal = new AbortController().signal,
    ): Promise<JsonValue> {
      if (handler === undefined) {
        return Promise.reject(new Error('server-request handler is not registered'))
      }
      return handler(request, signal)
    },
  }
}

type FakeClient = ReturnType<typeof createFakeClient>

function createAdapter(fake: FakeClient, experimentalDynamicTools: boolean): CodexAdapter {
  return new CodexAdapter({
    client: fake.client,
    cwd: '/workspace',
    sandbox: 'workspace-write',
    approvalPolicy: 'untrusted',
    allowApiKeyAuth: false,
    requestTimeoutMs: 100,
    turnTimeoutMs: 1_000,
    experimentalDynamicTools,
  })
}

function userMessage(id: string, text: string): Message {
  return {
    id: MessageId(id),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

function assistantToolCallMessage(callId: string): Message {
  return {
    id: MessageId(`assistant-${callId}`),
    role: 'assistant',
    content: [{
      type: 'tool-call',
      id: CallId(callId),
      name: TOOL.name,
      arguments: '{"task":"implement"}',
    }],
    source: {
      kind: 'model',
      provider: CODEX_PROVIDER,
      model: 'gpt-test',
    },
  }
}

function toolResultMessage(
  id: string,
  callId: string,
  text: string,
  isError = false,
): Message {
  return {
    id: MessageId(id),
    role: 'user',
    content: [{
      type: 'tool-result',
      toolCallId: CallId(callId),
      content: [{ type: 'text', text }],
      isError,
    }],
    source: { kind: 'tool', callId: CallId(callId) },
  }
}

function options(
  messages: Message[],
  tools: NonNullable<GenerateOptions['tools']> = [TOOL],
  overrides: Partial<GenerateOptions> = {},
): GenerateOptions {
  return {
    provider: CODEX_PROVIDER,
    model: 'gpt-test',
    sessionId: 'session-tools' as NonNullable<GenerateOptions['sessionId']>,
    messages,
    tools,
    ...overrides,
  }
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function emitCompletedTurn(fake: FakeClient, text = 'done'): void {
  fake.emit({
    method: 'turn/completed',
    params: {
      threadId: 'thread-tools',
      turn: {
        id: 'turn-tools',
        status: 'completed',
        items: [{ type: 'agentMessage', text }],
        error: null,
      },
    },
  })
}

async function beginDynamicCall(
  fake: FakeClient,
  adapter: CodexAdapter,
  callId = 'call-claude',
): Promise<{
  readonly initialUser: Message
  readonly response: Promise<JsonValue>
  readonly chunks: readonly StreamChunk[]
}> {
  const initialUser = userMessage('user-initial', 'implement the task')
  const firstStream = collect(adapter.stream(options([initialUser])))
  await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
  const response = fake.requestDynamicTool(
    callId,
    TOOL.name,
    { task: 'implement' },
  )
  const chunks = await firstStream
  return { initialUser, response, chunks }
}

describe('experimental dynamic-tool bridge', () => {
  it('maps a call to canonical chunks and continues the same Codex turn after success', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const initialUser = userMessage('user-initial', 'implement the task')
    const firstStream = collect(adapter.stream(options([initialUser])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())

    const response = fake.requestDynamicTool(
      'call-claude',
      TOOL.name,
      { task: 'implement' },
    )
    const firstChunks = await firstStream

    expect(firstChunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: CallId('call-claude'),
        name: TOOL.name,
        argumentsDelta: '{"task":"implement"}',
      },
      {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: CallId('call-claude'),
          name: TOOL.name,
          arguments: '{"task":"implement"}',
        },
      },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])

    const continuation = collect(adapter.stream(options([
      initialUser,
      assistantToolCallMessage('call-claude'),
      toolResultMessage('tool-result-claude', 'call-claude', 'implemented'),
    ])))
    await expect(response).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'implemented' }],
      success: true,
    })
    emitCompletedTurn(fake)

    await expect(continuation).resolves.toEqual([
      { type: 'block-start', index: 0, blockType: 'text' },
      { type: 'text-delta', index: 0, text: 'done' },
      { type: 'block-end', index: 0, block: { type: 'text', text: 'done' } },
      {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: {
          response: {
            version: 1,
            threadId: 'thread-tools',
            turnId: 'turn-tools',
          },
        },
      },
    ])
    expect(fake.methods.startTurn).toHaveBeenCalledOnce()
  })

  it('maps an errored DSH tool result to an unsuccessful app-server response', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const initialUser = userMessage('user-initial', 'implement the task')
    const firstStream = collect(adapter.stream(options([initialUser])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const response = fake.requestDynamicTool(
      'call-claude',
      TOOL.name,
      { task: 'implement' },
    )
    await firstStream

    const continuation = collect(adapter.stream(options([
      initialUser,
      assistantToolCallMessage('call-claude'),
      toolResultMessage('tool-result-claude', 'call-claude', 'Claude failed', true),
    ])))
    await expect(response).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'Claude failed' }],
      success: false,
    })
    emitCompletedTurn(fake, 'fallback complete')
    await expect(continuation).resolves.toContainEqual({
      type: 'finish',
      reason: { kind: 'stop' },
      replayState: {
        response: {
          version: 1,
          threadId: 'thread-tools',
          turnId: 'turn-tools',
        },
      },
    })
  })

  it('keeps stable mode fail closed for calls and tool-result continuations', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, false)

    expect(fake.methods.registerServerRequestHandler).not.toHaveBeenCalled()
    await expect(fake.requestDynamicTool(
      'call-disabled',
      TOOL.name,
      { task: 'blocked' },
    )).rejects.toThrow(/not registered/u)
    await expect(collect(adapter.stream(options([
      toolResultMessage('tool-result-disabled', 'call-disabled', 'blocked'),
    ])))).rejects.toMatchObject({
      failure: { code: 'UNSUPPORTED_TOOL_CONTINUATION' },
    })
  })

  it.each([
    [
      'tool count',
      () => Array.from({ length: MAX_DYNAMIC_TOOLS + 1 }, (_, index) => ({
        ...TOOL,
        name: `tool_${index}`,
      })),
      'DYNAMIC_TOOL_CATALOG_LIMIT',
    ],
    [
      'empty name',
      () => [{ ...TOOL, name: '' }],
      'DYNAMIC_TOOL_NAME_INVALID',
    ],
    [
      'invalid name characters',
      () => [{ ...TOOL, name: 'delegate claude' }],
      'DYNAMIC_TOOL_NAME_INVALID',
    ],
    [
      'name bytes',
      () => [{ ...TOOL, name: 'a'.repeat(MAX_DYNAMIC_TOOL_NAME_BYTES + 1) }],
      'DYNAMIC_TOOL_NAME_TOO_LARGE',
    ],
    [
      'description bytes',
      () => [{
        ...TOOL,
        description: 'a'.repeat(MAX_DYNAMIC_TOOL_DESCRIPTION_BYTES + 1),
      }],
      'DYNAMIC_TOOL_DESCRIPTION_TOO_LARGE',
    ],
    [
      'duplicate name',
      () => [TOOL, { ...TOOL }],
      'DYNAMIC_TOOL_DUPLICATE_NAME',
    ],
    [
      'non-JSON schema',
      () => [{
        ...TOOL,
        parameters: { invalid: undefined } as unknown as Record<string, unknown>,
      }],
      'DYNAMIC_TOOL_SCHEMA_INVALID',
    ],
    [
      'schema bytes',
      () => [{
        ...TOOL,
        parameters: { description: 'a'.repeat(MAX_DYNAMIC_TOOL_SCHEMA_BYTES) },
      }],
      'DYNAMIC_TOOL_SCHEMA_TOO_LARGE',
    ],
    [
      'catalog bytes',
      () => Array.from({
        length: Math.ceil(MAX_DYNAMIC_TOOL_CATALOG_BYTES / 60_000),
      }, (_, index) => ({
        ...TOOL,
        name: `large_${index}`,
        parameters: { description: 'a'.repeat(60_000) },
      })),
      'DYNAMIC_TOOL_CATALOG_TOO_LARGE',
    ],
  ] as const)('rejects an invalid dynamic-tool %s', async (_label, makeTools, code) => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)

    await expect(collect(adapter.stream(options(
      [userMessage('user-invalid', 'test invalid catalog')],
      makeTools(),
    )))).rejects.toMatchObject({ failure: { code } })
    expect(fake.methods.startThread).not.toHaveBeenCalled()
    await adapter.close()
  })

  it('accepts the exact name, description and catalog-count boundaries', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const tools = Array.from({ length: MAX_DYNAMIC_TOOLS }, (_, index) => ({
      ...TOOL,
      name: index === 0
        ? 'a'.repeat(MAX_DYNAMIC_TOOL_NAME_BYTES)
        : `tool_${index}`,
      description: index === 0
        ? 'a'.repeat(MAX_DYNAMIC_TOOL_DESCRIPTION_BYTES)
        : TOOL.description,
    }))
    fake.methods.startTurn.mockImplementationOnce(async () => {
      queueMicrotask(() => emitCompletedTurn(fake))
      return { id: 'turn-tools', status: 'inProgress', items: [], error: null }
    })

    await expect(collect(adapter.stream(options([
      userMessage('user-boundary', 'test valid boundaries'),
    ], tools)))).resolves.toContainEqual(expect.objectContaining({
      type: 'finish',
      reason: { kind: 'stop' },
    }))
    expect(fake.methods.startThread).toHaveBeenCalledWith(
      expect.objectContaining({
        dynamicTools: expect.arrayContaining([
          expect.objectContaining({
            name: 'a'.repeat(MAX_DYNAMIC_TOOL_NAME_BYTES),
            description: 'a'.repeat(MAX_DYNAMIC_TOOL_DESCRIPTION_BYTES),
          }),
        ]),
      }),
      expect.any(Object),
    )
    await adapter.close()
  })

  it('exposes multiple concurrent calls with stable indexes and correlates reversed results', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const initialUser = userMessage('user-multiple', 'delegate twice')
    const firstStream = collect(adapter.stream(options([initialUser])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const firstResponse = fake.requestDynamicTool('call-1', TOOL.name, { task: 'one' })
    const secondResponse = fake.requestDynamicTool('call-2', TOOL.name, { task: 'two' })

    const chunks = await firstStream

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta', index: 0, id: CallId('call-1'),
        name: TOOL.name, argumentsDelta: '{"task":"one"}',
      },
      {
        type: 'block-end', index: 0,
        block: {
          type: 'tool-call', id: CallId('call-1'), name: TOOL.name,
          arguments: '{"task":"one"}',
        },
      },
      { type: 'block-start', index: 1, blockType: 'tool-call' },
      {
        type: 'tool-call-delta', index: 1, id: CallId('call-2'),
        name: TOOL.name, argumentsDelta: '{"task":"two"}',
      },
      {
        type: 'block-end', index: 1,
        block: {
          type: 'tool-call', id: CallId('call-2'), name: TOOL.name,
          arguments: '{"task":"two"}',
        },
      },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])

    const continuation = collect(adapter.stream(options([
      initialUser,
      assistantToolCallMessage('call-1'),
      assistantToolCallMessage('call-2'),
      toolResultMessage('result-2', 'call-2', 'two done'),
      toolResultMessage('result-1', 'call-1', 'one done'),
    ])))
    await expect(firstResponse).resolves.toMatchObject({
      contentItems: [{ type: 'inputText', text: 'one done' }],
      success: true,
    })
    await expect(secondResponse).resolves.toMatchObject({
      contentItems: [{ type: 'inputText', text: 'two done' }],
      success: true,
    })
    emitCompletedTurn(fake)
    await expect(continuation).resolves.toContainEqual(expect.objectContaining({
      type: 'finish', reason: { kind: 'stop' },
    }))
    expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    await adapter.close()
  })

  it.each([
    ['missing', [], 'DYNAMIC_TOOL_RESULT_MISSING'],
    [
      'unknown',
      [toolResultMessage('result-unknown', 'call-unknown', 'unknown')],
      'DYNAMIC_TOOL_RESULT_UNKNOWN',
    ],
  ] as const)('rejects a %s tool result correlation', async (_label, results, code) => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const { initialUser, response } = await beginDynamicCall(fake, adapter)
    const responseFailure = response.catch((error: unknown) => error)

    await expect(collect(adapter.stream(options([
      initialUser,
      assistantToolCallMessage('call-claude'),
      ...results,
    ])))).rejects.toMatchObject({ failure: { code } })
    await adapter.close()
    await expect(responseFailure).resolves.toBeInstanceOf(Error)
  })

  it('rejects duplicate tool results before resolving either call twice', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const initialUser = userMessage('user-duplicates', 'delegate twice')
    const firstStream = collect(adapter.stream(options([initialUser])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const firstResponse = fake.requestDynamicTool('call-1', TOOL.name, { task: 'one' })
    const secondResponse = fake.requestDynamicTool('call-2', TOOL.name, { task: 'two' })
    const responseFailures = [firstResponse, secondResponse].map(async (response) => (
      await response.catch((error: unknown) => error)
    ))
    await firstStream

    await expect(collect(adapter.stream(options([
      initialUser,
      assistantToolCallMessage('call-1'),
      assistantToolCallMessage('call-2'),
      toolResultMessage('result-1a', 'call-1', 'first'),
      toolResultMessage('result-1b', 'call-1', 'duplicate'),
    ])))).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_RESULT_DUPLICATE' },
    })
    await adapter.close()
    await Promise.all(responseFailures)
  })

  it.each([
    [
      'non-text content',
      {
        ...toolResultMessage('result-unsupported', 'call-claude', ''),
        content: [{
          type: 'tool-result',
          toolCallId: CallId('call-claude'),
          content: [{ type: 'reasoning', text: 'not a result' }],
        }],
      } as Message,
      'DYNAMIC_TOOL_RESULT_UNSUPPORTED',
    ],
    [
      'oversized text',
      toolResultMessage(
        'result-large',
        'call-claude',
        'a'.repeat(MAX_DYNAMIC_TOOL_RESULT_BYTES + 1),
      ),
      'DYNAMIC_TOOL_RESULT_TOO_LARGE',
    ],
  ] as const)('fails closed for %s tool results', async (_label, result, code) => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const { initialUser, response } = await beginDynamicCall(fake, adapter)
    const responseFailure = response.catch((error: unknown) => error)

    await expect(collect(adapter.stream(options([
      initialUser,
      assistantToolCallMessage('call-claude'),
      result,
    ])))).rejects.toMatchObject({ failure: { code } })
    await adapter.close()
    await responseFailure
  })

  it('rejects unknown, namespaced, oversized and malformed server calls', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const controller = new AbortController()
    const stream = collect(adapter.stream(options(
      [userMessage('user-calls', 'validate calls')],
      [TOOL],
      { signal: controller.signal },
    )))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())

    await expect(fake.requestDynamicTool(
      'call-unknown-tool', 'missing_tool', {},
    )).rejects.toMatchObject({ failure: { code: 'DYNAMIC_TOOL_UNKNOWN' } })
    await expect(fake.requestServer({
      id: 'rpc-namespace',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-tools', turnId: 'turn-tools', callId: 'call-namespace',
        namespace: 'agents', tool: TOOL.name, arguments: {},
      },
    })).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_NAMESPACE_UNSUPPORTED' },
    })
    await expect(fake.requestDynamicTool(
      'call-large',
      TOOL.name,
      { payload: 'a'.repeat(MAX_DYNAMIC_TOOL_ARGUMENT_BYTES) },
    )).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_ARGUMENTS_TOO_LARGE' },
    })
    expect(() => fake.requestServer({
      id: 'rpc-malformed',
      method: 'item/tool/call',
      params: {
        threadId: 'thread-tools', turnId: 'turn-tools',
        namespace: null, tool: TOOL.name, arguments: {},
      },
    })).toThrow(/callId/u)

    controller.abort(new LlmError('cancelled', 'ABORTED'))
    await expect(stream).resolves.toContainEqual(expect.objectContaining({
      type: 'finish', reason: expect.objectContaining({ kind: 'aborted' }),
    }))
    await adapter.close()
  })

  it('enforces the pending-call bound and rejects duplicate call ids', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const stream = collect(adapter.stream(options([
      userMessage('user-pending-limit', 'delegate many'),
    ])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const responses = Array.from({ length: MAX_PENDING_DYNAMIC_TOOL_CALLS }, (_, index) => (
      fake.requestDynamicTool(`call-${index}`, TOOL.name, { index })
    ))
    const responseFailures = responses.map(async (response) => (
      await response.catch((error: unknown) => error)
    ))

    await expect(fake.requestDynamicTool(
      'call-over-limit', TOOL.name, {},
    )).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_PENDING_LIMIT' },
    })
    await expect(fake.requestDynamicTool(
      'call-0', TOOL.name, {}, 'rpc-duplicate',
    )).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_DUPLICATE' },
    })
    const chunks = await stream
    expect(chunks.filter((chunk) => chunk.type === 'block-end')).toHaveLength(
      MAX_PENDING_DYNAMIC_TOOL_CALLS,
    )
    await adapter.close()
    await Promise.all(responseFailures)
  })

  it('aborts and closes deferred calls without starting another Codex turn', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const controller = new AbortController()
    const initialUser = userMessage('user-abort', 'delegate then abort')
    const firstStream = collect(adapter.stream(options(
      [initialUser],
      [TOOL],
      { signal: controller.signal },
    )))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const response = fake.requestDynamicTool('call-abort', TOOL.name, {})
    await firstStream

    controller.abort(new LlmError('cancelled by user', 'ABORTED'))

    await expect(response).rejects.toMatchObject({ failure: { code: 'ABORTED' } })
    await vi.waitFor(() => expect(fake.methods.interruptTurn).toHaveBeenCalledOnce())
    await adapter.close()
    expect(fake.methods.close).toHaveBeenCalledOnce()
    expect(fake.methods.startTurn).toHaveBeenCalledOnce()
  })

  it('fails pending calls with ADAPTER_CLOSED and unregisters the handler', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const { response } = await beginDynamicCall(fake, adapter)

    const closed = adapter.close()

    await expect(response).rejects.toMatchObject({
      failure: { code: 'ADAPTER_CLOSED' },
    })
    await closed
    expect(fake.methods.close).toHaveBeenCalledOnce()
    await expect(fake.requestDynamicTool(
      'call-after-close', TOOL.name, {},
    )).rejects.toThrow(/not registered/u)
  })

  it('continues a prepared LlmRuntime call without repeating account or model RPCs', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const ctx = new Context()
    const llmFiber = await ctx.plugin(LlmRuntime)
    const unregister = ctx.llm.registerAdapter([CODEX_PROVIDER], adapter)
    const initialUser = userMessage('runtime-user', 'delegate through runtime')
    const firstPrepared = await ctx.llm.prepareCall({
      provider: CODEX_PROVIDER,
      model: MODEL.model,
    })
    const firstStream = collect(firstPrepared.stream(options([initialUser])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const response = fake.requestDynamicTool(
      'runtime-call',
      TOOL.name,
      { task: 'runtime' },
    )
    await firstStream
    const accountReadsWhileWaiting = fake.methods.readAccount.mock.calls.length
    const modelListsWhileWaiting = fake.methods.listModels.mock.calls.length

    const secondPrepared = await ctx.llm.prepareCall({
      provider: CODEX_PROVIDER,
      model: MODEL.model,
    })
    const continuation = collect(secondPrepared.stream(options([
      initialUser,
      assistantToolCallMessage('runtime-call'),
      toolResultMessage('runtime-result', 'runtime-call', 'runtime done'),
    ])))
    await expect(response).resolves.toEqual({
      contentItems: [{ type: 'inputText', text: 'runtime done' }],
      success: true,
    })
    emitCompletedTurn(fake, 'runtime complete')
    await expect(continuation).resolves.toContainEqual(expect.objectContaining({
      type: 'finish',
      reason: { kind: 'stop' },
    }))

    expect(fake.methods.readAccount).toHaveBeenCalledTimes(accountReadsWhileWaiting)
    expect(fake.methods.listModels).toHaveBeenCalledTimes(modelListsWhileWaiting)
    expect(fake.methods.startTurn).toHaveBeenCalledOnce()
    unregister()
    await adapter.close()
    await llmFiber.dispose()
  })

  it('resolves another session model from the complete cache while a tool call is pending', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const ctx = new Context()
    const llmFiber = await ctx.plugin(LlmRuntime)
    const unregister = ctx.llm.registerAdapter([CODEX_PROVIDER], adapter)
    const firstPrepared = await ctx.llm.prepareCall({
      provider: CODEX_PROVIDER,
      model: MODEL.model,
    })
    const firstStream = collect(firstPrepared.stream(options([
      userMessage('cache-user-a', 'start a delegated task'),
    ])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const pendingResponse = fake.requestDynamicTool(
      'cache-call-a',
      TOOL.name,
      { task: 'hold session A' },
    )
    const pendingFailure = pendingResponse.catch((error: unknown) => error)
    await firstStream
    const accountReads = fake.methods.readAccount.mock.calls.length
    const modelLists = fake.methods.listModels.mock.calls.length

    await expect(ctx.llm.prepareCall({
      provider: CODEX_PROVIDER,
      model: SECOND_MODEL.model,
    })).resolves.toBeDefined()
    await expect(ctx.llm.prepareCall({
      provider: CODEX_PROVIDER,
      model: 'missing-model',
    })).rejects.toMatchObject({ failure: { code: 'UNKNOWN_MODEL' } })
    expect(fake.methods.readAccount).toHaveBeenCalledTimes(accountReads)
    expect(fake.methods.listModels).toHaveBeenCalledTimes(modelLists)

    unregister()
    await adapter.close()
    await pendingFailure
    await llmFiber.dispose()
  })

  it('replaces stale model metadata with each complete catalog snapshot', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    await adapter.resolveModel(CODEX_PROVIDER, SECOND_MODEL.model)
    fake.methods.listModels.mockResolvedValue([MODEL])
    await adapter.resolveModel(CODEX_PROVIDER, MODEL.model)
    const { response } = await beginDynamicCall(fake, adapter, 'snapshot-call')
    const responseFailure = response.catch((error: unknown) => error)
    const modelLists = fake.methods.listModels.mock.calls.length

    await expect(adapter.resolveModel(
      CODEX_PROVIDER,
      SECOND_MODEL.model,
    )).rejects.toMatchObject({ failure: { code: 'UNKNOWN_MODEL' } })
    expect(fake.methods.listModels).toHaveBeenCalledTimes(modelLists)

    await adapter.close()
    await responseFailure
  })

  it('does not claim catalog completeness when unique model aliases exceed the cache bound', async () => {
    const fake = createFakeClient()
    const largeCatalog = Array.from({ length: 129 }, (_, index): CodexModel => ({
      ...MODEL,
      id: `large-id-${String(index)}`,
      model: `large-model-${String(index)}`,
      displayName: `Large Model ${String(index)}`,
      isDefault: index === 0,
    }))
    fake.methods.listModels.mockResolvedValue(largeCatalog)
    const adapter = createAdapter(fake, true)
    await adapter.resolveModel(CODEX_PROVIDER, largeCatalog[0]?.model ?? '')
    const { response } = await beginDynamicCall(fake, adapter, 'large-cache-call')
    const responseFailure = response.catch((error: unknown) => error)
    const modelLists = fake.methods.listModels.mock.calls.length

    await expect(adapter.resolveModel(
      CODEX_PROVIDER,
      largeCatalog[1]?.model ?? '',
    )).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_MODEL_METADATA_MISSING' },
    })
    expect(fake.methods.listModels).toHaveBeenCalledTimes(modelLists)

    await adapter.close()
    await responseFailure
  })

  it('fails closed when a tool-result tries to replay pending dynamic state', async () => {
    const original = createFakeClient()
    const originalAdapter = createAdapter(original, true)
    const { initialUser, response } = await beginDynamicCall(original, originalAdapter)
    const responseFailure = response.catch((error: unknown) => error)
    await originalAdapter.close()
    await responseFailure
    const replayedAssistant: Message = {
      ...assistantToolCallMessage('call-claude'),
      source: {
        kind: 'model',
        provider: CODEX_PROVIDER,
        model: MODEL.model,
        replayState: {
          response: {
            version: 1,
            threadId: 'thread-tools',
            turnId: 'turn-tools',
            pendingDynamicTools: true,
          },
        },
      },
    }
    const fresh = createFakeClient()
    const freshAdapter = createAdapter(fresh, true)

    await expect(collect(freshAdapter.stream(options([
      initialUser,
      replayedAssistant,
      toolResultMessage('replayed-result', 'call-claude', 'must not dispatch'),
    ])))).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_STATE_LOST' },
    })
    expect(fresh.methods.startThread).not.toHaveBeenCalled()
    expect(fresh.methods.startTurn).not.toHaveBeenCalled()
    await freshAdapter.close()
  })

  it.each([
    [
      'duplicate',
      () => [
        toolResultMessage('atomic-valid', 'atomic-1', 'must stay buffered'),
        toolResultMessage('atomic-duplicate', 'atomic-1', 'duplicate'),
      ],
      'DYNAMIC_TOOL_RESULT_DUPLICATE',
    ],
    [
      'invalid source correlation',
      () => [
        toolResultMessage('atomic-valid', 'atomic-1', 'must stay buffered'),
        {
          ...toolResultMessage('atomic-invalid', 'atomic-2', 'invalid'),
          source: { kind: 'tool' as const, callId: CallId('atomic-1') },
        },
      ],
      'DYNAMIC_TOOL_RESULT_INVALID',
    ],
    [
      'oversized',
      () => [
        toolResultMessage('atomic-valid', 'atomic-1', 'must stay buffered'),
        toolResultMessage(
          'atomic-large',
          'atomic-2',
          'a'.repeat(MAX_DYNAMIC_TOOL_RESULT_BYTES + 1),
        ),
      ],
      'DYNAMIC_TOOL_RESULT_TOO_LARGE',
    ],
  ] as const)(
    'rejects an entire %s result batch before sending any app-server response',
    async (_label, makeResults, code) => {
      const fake = createFakeClient()
      const adapter = createAdapter(fake, true)
      const initialUser = userMessage('atomic-user', 'delegate atomically')
      const firstStream = collect(adapter.stream(options([initialUser])))
      await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
      const firstResponse = fake.requestDynamicTool('atomic-1', TOOL.name, { task: 'one' })
      const secondResponse = fake.requestDynamicTool('atomic-2', TOOL.name, { task: 'two' })
      const firstResolved = vi.fn()
      const secondResolved = vi.fn()
      void firstResponse.then(firstResolved, () => {})
      void secondResponse.then(secondResolved, () => {})
      await firstStream

      await expect(collect(adapter.stream(options([
        initialUser,
        assistantToolCallMessage('atomic-1'),
        assistantToolCallMessage('atomic-2'),
        ...makeResults(),
      ])))).rejects.toMatchObject({ failure: { code } })

      expect(firstResolved).not.toHaveBeenCalled()
      expect(secondResolved).not.toHaveBeenCalled()
      await expect(firstResponse).rejects.toMatchObject({ failure: { code } })
      await expect(secondResponse).rejects.toMatchObject({ failure: { code } })
      expect(fake.methods.interruptTurn).toHaveBeenCalledOnce()
      expect(fake.methods.close).not.toHaveBeenCalled()
      await adapter.close()
    },
  )

  it('accepts a 256-byte UTF-8 call id and rejects 257 bytes before call history', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const stream = collect(adapter.stream(options([
      userMessage('call-id-user', 'validate call ids'),
    ])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const acceptedCallId = 'é'.repeat(MAX_DYNAMIC_TOOL_CALL_ID_BYTES / 2)
    const oversizedCallId = `${acceptedCallId}a`

    await expect(fake.requestDynamicTool(
      oversizedCallId,
      TOOL.name,
      { task: 'reject' },
    )).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_CALL_ID_TOO_LARGE' },
    })
    await expect(fake.requestDynamicTool(
      oversizedCallId,
      TOOL.name,
      { task: 'reject again' },
      'rpc-oversized-again',
    )).rejects.toMatchObject({
      failure: { code: 'DYNAMIC_TOOL_CALL_ID_TOO_LARGE' },
    })
    const acceptedResponse = fake.requestDynamicTool(
      acceptedCallId,
      TOOL.name,
      { task: 'accept' },
    )
    const acceptedFailure = acceptedResponse.catch((error: unknown) => error)

    await expect(stream).resolves.toEqual([
      { type: 'block-start', index: 0, blockType: 'tool-call' },
      {
        type: 'tool-call-delta',
        index: 0,
        id: CallId(acceptedCallId),
        name: TOOL.name,
        argumentsDelta: '{"task":"accept"}',
      },
      {
        type: 'block-end',
        index: 0,
        block: {
          type: 'tool-call',
          id: CallId(acceptedCallId),
          name: TOOL.name,
          arguments: '{"task":"accept"}',
        },
      },
      { type: 'finish', reason: { kind: 'tool-calls' } },
    ])
    await adapter.close()
    await acceptedFailure
  })

  it('interrupts a timed-out server request once and safely starts the next turn', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake, true)
    const initialUser = userMessage('timeout-user', 'delegate then time out')
    const firstStream = collect(adapter.stream(options([initialUser])))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())
    const requestController = new AbortController()
    const response = fake.requestDynamicTool(
      'timeout-call',
      TOOL.name,
      { task: 'wait' },
      'rpc-timeout',
      requestController.signal,
    )
    await firstStream
    const timeout = new Error('Codex app-server server request timed out')
    timeout.name = 'AppServerTimeoutError'

    requestController.abort(timeout)

    await expect(response).rejects.toBe(timeout)
    await vi.waitFor(() => expect(fake.methods.interruptTurn).toHaveBeenCalledOnce())
    expect(fake.methods.close).not.toHaveBeenCalled()

    fake.methods.startTurn.mockImplementationOnce(async () => {
      queueMicrotask(() => emitCompletedTurn(fake, 'next turn safe'))
      return { id: 'turn-tools', status: 'inProgress', items: [], error: null }
    })
    await expect(collect(adapter.stream(options([
      initialUser,
      userMessage('after-timeout', 'continue safely'),
    ])))).resolves.toContainEqual(expect.objectContaining({
      type: 'finish',
      reason: { kind: 'stop' },
    }))
    expect(fake.methods.startTurn).toHaveBeenCalledTimes(2)
    expect(fake.methods.interruptTurn).toHaveBeenCalledOnce()
    expect(fake.methods.close).not.toHaveBeenCalled()
    await adapter.close()
  })
})
