import {
  MessageId,
  ReasoningEffortId,
  type GenerateOptions,
  type Message,
  type StreamChunk,
} from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import type { AttachmentStore } from '@deepseek-ai/dsh-attachment'

import {
  CODEX_PROVIDER,
  MAX_SESSION_STATES,
  CodexAdapter,
} from '../src/adapter.js'
import type { AppServerClient } from '../src/app-server/client.js'
import type {
  AppServerNotification,
  CodexAccountStatus,
  CodexModel,
  CodexTurn,
} from '../src/app-server/types.js'

const MODEL: CodexModel = {
  id: 'model-id',
  model: 'gpt-test',
  displayName: 'GPT Test',
  description: 'Test model',
  hidden: false,
  isDefault: true,
  inputModalities: ['text', 'image'],
  reasoningEfforts: [
    { id: 'low', description: 'Fast' },
    { id: 'high', description: '' },
  ],
  defaultReasoningEffort: 'low',
}

type NotificationListener = (notification: AppServerNotification) => void

function createFakeClient() {
  const listeners = new Set<NotificationListener>()
  const client = {
    readAccount: vi.fn(async (): Promise<CodexAccountStatus> => ({
      authenticated: true,
      kind: 'chatgpt',
      requiresOpenaiAuth: true,
    })),
    listModels: vi.fn(async () => [MODEL] as readonly CodexModel[]),
    startThread: vi.fn(async () => ({ id: 'thread-1' })),
    resumeThread: vi.fn(async (options: { readonly threadId: string }) => ({
      id: options.threadId,
    })),
    startTurn: vi.fn(async (): Promise<CodexTurn> => ({
      id: 'turn-1',
      status: 'inProgress',
      items: [],
      error: null,
    })),
    interruptTurn: vi.fn(async () => undefined),
    onNotification: vi.fn((listener: NotificationListener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    }),
    close: vi.fn(async () => undefined),
  }
  return {
    client: client as unknown as AppServerClient,
    methods: client,
    emit(notification: AppServerNotification): void {
      for (const listener of listeners) listener(notification)
    },
  }
}

type FakeClient = ReturnType<typeof createFakeClient>

function createAdapter(
  fake: FakeClient,
  allowApiKeyAuth = false,
  attachments?: AttachmentStore,
): CodexAdapter {
  return new CodexAdapter({
    client: fake.client,
    cwd: '/workspace',
    sandbox: 'workspace-write',
    approvalPolicy: 'untrusted',
    allowApiKeyAuth,
    requestTimeoutMs: 100,
    turnTimeoutMs: 1_000,
    ...(attachments === undefined ? {} : { attachments: () => attachments }),
  })
}

const IMAGE_BYTES = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])

function imageStore(): {
  readonly store: AttachmentStore
  readonly readImageRequest: ReturnType<typeof vi.fn>
} {
  const readImageRequest = vi.fn(async () => ({
    data: IMAGE_BYTES,
    mediaType: 'image/png',
  }))
  return { store: { readImageRequest } as unknown as AttachmentStore, readImageRequest }
}

function imageMessage(id: string, text: string): Message {
  return {
    id: MessageId(id),
    role: 'user',
    content: [
      { type: 'text', text },
      {
        type: 'image',
        attachment: {
          attachmentId: 'attachment-1',
          mediaType: 'image/png',
          bytes: IMAGE_BYTES.byteLength,
          width: 2,
          height: 2,
        },
      } as Message['content'][number],
    ],
    source: { kind: 'user' },
  }
}

function userMessage(id: string, text: string): Message {
  return {
    id: MessageId(id),
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'user' },
  }
}

function assistantMessage(
  id: string,
  provider: string,
  replayState: unknown,
): Message {
  return {
    id: MessageId(id),
    role: 'assistant',
    content: [{ type: 'text', text: 'historical answer' }],
    source: {
      kind: 'model',
      provider,
      model: MODEL.model,
      replayState,
    },
  }
}

function generateOptions(
  messages: Message[] = [userMessage('message-1', 'hello')],
  sessionId: string | undefined = 'session-1',
): GenerateOptions {
  return {
    provider: CODEX_PROVIDER,
    model: MODEL.model,
    messages,
    ...(sessionId === undefined
      ? {}
      : { sessionId: sessionId as NonNullable<GenerateOptions['sessionId']> }),
  }
}

async function collect(iterable: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

function emitCompletedTurn(
  fake: FakeClient,
  options: {
    readonly status?: 'completed' | 'failed' | 'interrupted'
    readonly threadId?: string
    readonly turnId?: string
    readonly withDeltas?: boolean
    readonly withUsage?: boolean
  } = {},
): void {
  const threadId = options.threadId ?? 'thread-1'
  const turnId = options.turnId ?? 'turn-1'
  if (options.withDeltas === true) {
    fake.emit({
      method: 'item/reasoning/summaryTextDelta',
      params: { threadId, turnId, itemId: 'reasoning-1', delta: 'think', summaryIndex: 0 },
    })
    fake.emit({
      method: 'item/agentMessage/delta',
      params: { threadId, turnId, itemId: 'message-1', delta: 'answer' },
    })
  }
  if (options.withUsage === true) {
    fake.emit({
      method: 'thread/tokenUsage/updated',
      params: {
        threadId,
        turnId,
        tokenUsage: {
          last: {
            totalTokens: 30,
            inputTokens: 20,
            cachedInputTokens: 4,
            cacheWriteInputTokens: 3,
            outputTokens: 10,
            reasoningOutputTokens: 2,
          },
        },
      },
    })
  }
  fake.emit({
    method: 'turn/completed',
    params: {
      threadId,
      turn: {
        id: turnId,
        status: options.status ?? 'completed',
        items: options.withDeltas === true
          ? []
          : [{ type: 'agentMessage', text: 'final answer' }],
        error: options.status === 'failed'
          ? { message: 'Bearer private-token' }
          : null,
      },
    },
  })
}

function completeNextTurn(fake: FakeClient, options: Parameters<typeof emitCompletedTurn>[1] = {}): void {
  fake.methods.startTurn.mockImplementationOnce(async () => {
    queueMicrotask(() => emitCompletedTurn(fake, options))
    return { id: options.turnId ?? 'turn-1', status: 'inProgress', items: [], error: null }
  })
}

describe('CodexAdapter', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('requires a ChatGPT account by default', async () => {
    const fake = createFakeClient()
    fake.methods.readAccount.mockResolvedValue({
      authenticated: false,
      requiresOpenaiAuth: true,
    })
    const adapter = createAdapter(fake)

    await expect(adapter.listModels(CODEX_PROVIDER)).rejects.toMatchObject({
      failure: { code: 'AUTH' },
    })
  })

  it('gates API-key accounts behind allowApiKeyAuth', async () => {
    const denied = createFakeClient()
    denied.methods.readAccount.mockResolvedValue({
      authenticated: true,
      kind: 'apiKey',
      requiresOpenaiAuth: true,
    })
    await expect(createAdapter(denied).listModels(CODEX_PROVIDER)).rejects.toMatchObject({
      failure: { code: 'AUTH_MODE_UNSUPPORTED' },
    })

    const allowed = createFakeClient()
    allowed.methods.readAccount.mockResolvedValue({
      authenticated: true,
      kind: 'apiKey',
      requiresOpenaiAuth: true,
    })
    await expect(createAdapter(allowed, true).listModels(CODEX_PROVIDER)).resolves.toHaveLength(1)
  })

  it('lists visible models with their declared modalities and reasoning efforts', async () => {
    const fake = createFakeClient()
    fake.methods.listModels.mockResolvedValue([MODEL, { ...MODEL, id: 'hidden', hidden: true }])
    const adapter = createAdapter(fake)

    await expect(adapter.listModels(CODEX_PROVIDER)).resolves.toEqual([{
      provider: CODEX_PROVIDER,
      id: 'gpt-test',
      name: 'GPT Test',
      description: 'Test model',
      inputModalities: ['text', 'image'],
    }])
    await expect(adapter.resolveModel(CODEX_PROVIDER, 'model-id')).resolves.toMatchObject({
      id: 'gpt-test',
      reasoning: {
        efforts: [
          { id: ReasoningEffortId('low'), name: 'low', description: 'Fast' },
          { id: ReasoningEffortId('high'), name: 'high' },
        ],
        defaultEffort: ReasoningEffortId('low'),
      },
    })
  })

  it('reports UNKNOWN_MODEL for an absent catalog entry', async () => {
    const fake = createFakeClient()
    fake.methods.listModels.mockResolvedValue([])

    await expect(createAdapter(fake).resolveModel(CODEX_PROVIDER, 'missing')).rejects.toMatchObject({
      failure: { code: 'UNKNOWN_MODEL' },
    })
  })

  it('maps reasoning, text, block endings, usage and replay state exactly', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake, { withDeltas: true, withUsage: true })

    const chunks = await collect(createAdapter(fake).stream({
      ...generateOptions(),
      reasoningEffort: ReasoningEffortId('high'),
    }))

    expect(chunks).toEqual([
      { type: 'block-start', index: 0, blockType: 'reasoning' },
      { type: 'reasoning-delta', index: 0, text: 'think' },
      { type: 'block-start', index: 1, blockType: 'text' },
      { type: 'text-delta', index: 1, text: 'answer' },
      { type: 'block-end', index: 0, block: { type: 'reasoning', text: 'think' } },
      { type: 'block-end', index: 1, block: { type: 'text', text: 'answer' } },
      {
        type: 'usage',
        usage: {
          inputTokens: 13,
          outputTokens: 10,
          cacheReadTokens: 4,
          cacheWriteTokens: 3,
          reasoningTokens: 2,
        },
      },
      {
        type: 'finish',
        reason: { kind: 'stop' },
        replayState: {
          response: { version: 1, threadId: 'thread-1', turnId: 'turn-1' },
        },
      },
    ])
    expect(fake.methods.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({ effort: 'high' }),
      expect.any(Object),
    )
  })

  it('sends an attached image alongside its text', async () => {
    const fake = createFakeClient()
    const { store, readImageRequest } = imageStore()
    const adapter = createAdapter(fake, false, store)
    completeNextTurn(fake)

    await collect(adapter.stream(generateOptions([imageMessage('message-1', 'what is this?')])))

    expect(readImageRequest).toHaveBeenCalled()
    expect(fake.methods.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [
          { type: 'text', text: 'what is this?' },
          { type: 'image', url: `data:image/png;base64,${Buffer.from(IMAGE_BYTES).toString('base64')}` },
        ],
      }),
      expect.any(Object),
    )
  })

  it('reports an attached image it has no store to read', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake)

    await expect(collect(adapter.stream(generateOptions([
      imageMessage('message-1', 'what is this?'),
    ])))).rejects.toMatchObject({ failure: { code: 'UNSUPPORTED_CONTENT' } })
    expect(fake.methods.startTurn).not.toHaveBeenCalled()
  })

  it.each([
    ['failed', 'error', 'CODEX_TURN_FAILED'],
    ['interrupted', 'aborted', 'ABORTED'],
  ] as const)('maps %s turns to %s finishes', async (status, kind, code) => {
    const fake = createFakeClient()
    completeNextTurn(fake, { status })

    const chunks = await collect(createAdapter(fake).stream(generateOptions()))

    expect(chunks.at(-1)).toMatchObject({
      type: 'finish',
      reason: { kind, failure: { code } },
    })
    if (status === 'failed') {
      expect(JSON.stringify(chunks)).not.toContain('private-token')
    }
  })

  it('reuses a session thread and deduplicates user message ids', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake, { turnId: 'turn-1' })
    const adapter = createAdapter(fake)
    const first = userMessage('message-1', 'first')
    await collect(adapter.stream(generateOptions([first])))
    completeNextTurn(fake, { turnId: 'turn-2' })

    await collect(adapter.stream(generateOptions([first, userMessage('message-2', 'second')])))

    expect(fake.methods.startThread).toHaveBeenCalledOnce()
    expect(fake.methods.startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: [{ type: 'text', text: 'second' }] }),
      expect.any(Object),
    )
  })

  it('resumes from the newest assistant when compaction leaves an already-answered message behind', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake)

    completeNextTurn(fake, { turnId: 'turn-1' })
    await collect(adapter.stream(generateOptions([userMessage('m1', 'first')])))

    completeNextTurn(fake, { turnId: 'turn-2' })
    await collect(adapter.stream(generateOptions([
      userMessage('m1', 'first'),
      userMessage('m2', 'second'),
    ])))

    // Compaction drops the cursor (m2) but leaves m1 behind, and m1 was already
    // answered -- the assistant reply for it is still in the history. Resuming
    // from the whole retained history would re-send 'first' to a thread that
    // has already processed it.
    completeNextTurn(fake, { turnId: 'turn-3' })
    await collect(adapter.stream(generateOptions([
      userMessage('m1', 'first'),
      assistantMessage('a1', CODEX_PROVIDER, undefined),
      userMessage('m3', 'third'),
    ])))

    expect(fake.methods.startThread).toHaveBeenCalledOnce()
    expect(fake.methods.startTurn).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({ input: [{ type: 'text', text: 'third' }] }),
      expect.any(Object),
    )
  })

  it('continues a live session after request-history compaction removes its cursor', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake)
    completeNextTurn(fake, { turnId: 'turn-1' })

    await collect(adapter.stream(generateOptions([
      userMessage('message-1', 'first'),
    ])))
    completeNextTurn(fake, { turnId: 'turn-2' })

    await collect(adapter.stream(generateOptions([
      userMessage('message-2', 'second'),
    ])))

    expect(fake.methods.startThread).toHaveBeenCalledOnce()
    expect(fake.methods.startTurn).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ input: [{ type: 'text', text: 'second' }] }),
      expect.any(Object),
    )
  })

  it('resumes a replayed thread and sends only user messages newer than the replay', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake, { threadId: 'thread-replayed' })
    const history = [
      userMessage('message-old', 'old prompt'),
      assistantMessage('message-assistant', CODEX_PROVIDER, {
        response: {
          version: 1,
          threadId: 'thread-replayed',
          turnId: 'turn-old',
        },
      }),
      userMessage('message-new', 'new prompt'),
    ]

    await collect(createAdapter(fake).stream(generateOptions(history)))

    expect(fake.methods.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-replayed' }),
      expect.any(Object),
    )
    expect(fake.methods.startThread).not.toHaveBeenCalled()
    expect(fake.methods.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-replayed',
        input: [{ type: 'text', text: 'new prompt' }],
      }),
      expect.any(Object),
    )
  })

  it('accepts the direct replay response shape', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake, { threadId: 'thread-direct' })
    const history = [
      userMessage('message-old', 'old prompt'),
      assistantMessage('message-assistant', CODEX_PROVIDER, {
        version: 1,
        threadId: 'thread-direct',
        turnId: 'turn-old',
      }),
      userMessage('message-new', 'new prompt'),
    ]

    await collect(createAdapter(fake).stream(generateOptions(history)))

    expect(fake.methods.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-direct' }),
      expect.any(Object),
    )
    expect(fake.methods.startThread).not.toHaveBeenCalled()
  })

  it.each([
    [
      'foreign provider',
      assistantMessage('assistant-foreign', 'another-provider', {
        response: { version: 1, threadId: 'thread-foreign', turnId: 'turn-old' },
      }),
    ],
    [
      'malformed replay',
      assistantMessage('assistant-malformed', CODEX_PROVIDER, {
        response: { version: 2, threadId: 'thread-malformed', turnId: 'turn-old' },
      }),
    ],
  ] as const)('ignores %s state and starts a fresh thread', async (_label, assistant) => {
    const fake = createFakeClient()
    completeNextTurn(fake)
    const history = [
      userMessage('message-old', 'old prompt'),
      assistant,
      userMessage('message-new', 'new prompt'),
    ]

    await collect(createAdapter(fake).stream(generateOptions(history)))

    expect(fake.methods.resumeThread).not.toHaveBeenCalled()
    expect(fake.methods.startThread).toHaveBeenCalledOnce()
    expect(fake.methods.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [{ type: 'text', text: 'old prompt\n\nnew prompt' }],
      }),
      expect.any(Object),
    )
  })

  it('does not fall back to an older valid replay after the latest same-provider replay is malformed', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake)
    const history = [
      userMessage('message-old', 'old prompt'),
      assistantMessage('assistant-valid', CODEX_PROVIDER, {
        response: { version: 1, threadId: 'thread-valid-old', turnId: 'turn-old' },
      }),
      userMessage('message-middle', 'middle prompt'),
      assistantMessage('assistant-malformed-latest', CODEX_PROVIDER, {
        response: { version: 2, threadId: 'thread-invalid-new', turnId: 'turn-new' },
      }),
      userMessage('message-new', 'new prompt'),
    ]

    await collect(createAdapter(fake).stream(generateOptions(history)))

    expect(fake.methods.resumeThread).not.toHaveBeenCalled()
    expect(fake.methods.startThread).toHaveBeenCalledOnce()
    expect(fake.methods.startTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        input: [{
          type: 'text',
          text: 'old prompt\n\nmiddle prompt\n\nnew prompt',
        }],
      }),
      expect.any(Object),
    )
  })

  it('evicts the oldest inactive persistent session and restores it through replay', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake)
    for (let index = 0; index <= MAX_SESSION_STATES; index += 1) {
      completeNextTurn(fake, { turnId: `turn-${String(index)}` })
      await collect(adapter.stream(generateOptions(
        [userMessage(`message-${String(index)}`, `prompt-${String(index)}`)],
        `session-${String(index)}`,
      )))
    }
    expect(fake.methods.startThread).toHaveBeenCalledTimes(MAX_SESSION_STATES + 1)
    completeNextTurn(fake, { threadId: 'thread-restored', turnId: 'turn-restored' })
    const replayHistory = [
      userMessage('message-0', 'prompt-0'),
      assistantMessage('assistant-0', CODEX_PROVIDER, {
        response: {
          version: 1,
          threadId: 'thread-restored',
          turnId: 'turn-0',
        },
      }),
      userMessage('message-0-new', 'prompt-0-new'),
    ]

    await collect(adapter.stream(generateOptions(replayHistory, 'session-0')))

    expect(fake.methods.resumeThread).toHaveBeenCalledWith(
      expect.objectContaining({ threadId: 'thread-restored' }),
      expect.any(Object),
    )
    expect(fake.methods.startTurn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        threadId: 'thread-restored',
        input: [{ type: 'text', text: 'prompt-0-new' }],
      }),
      expect.any(Object),
    )
  })

  it('rejects concurrent turns for one session', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake)
    const controller = new AbortController()
    const first = collect(adapter.stream({ ...generateOptions(), signal: controller.signal }))
    await vi.waitFor(() => expect(fake.methods.startTurn).toHaveBeenCalledOnce())

    await expect(collect(adapter.stream(generateOptions([
      userMessage('message-2', 'second'),
    ])))).rejects.toMatchObject({ failure: { code: 'SESSION_BUSY' } })
    controller.abort()
    await first
  })

  it('interrupts an active turn after timeout and on AbortSignal', async () => {
    vi.useFakeTimers()
    const timed = createFakeClient()
    const timedAdapter = createAdapter(timed)
    const timedStream = collect(timedAdapter.stream(generateOptions()))
    await Promise.resolve()
    await Promise.resolve()
    await vi.advanceTimersByTimeAsync(1_000)
    await expect(timedStream).resolves.toContainEqual(expect.objectContaining({
      type: 'finish',
      reason: expect.objectContaining({ kind: 'aborted' }),
    }))
    expect(timed.methods.interruptTurn).toHaveBeenCalledWith(
      { threadId: 'thread-1', turnId: 'turn-1' },
      { timeoutMs: 100 },
    )

    vi.useRealTimers()
    const aborted = createFakeClient()
    const controller = new AbortController()
    const abortedStream = collect(createAdapter(aborted).stream({
      ...generateOptions(),
      signal: controller.signal,
    }))
    await vi.waitFor(() => expect(aborted.methods.startTurn).toHaveBeenCalledOnce())
    controller.abort(new Error('cancelled'))
    await expect(abortedStream).resolves.toContainEqual(expect.objectContaining({
      type: 'finish',
      reason: expect.objectContaining({ kind: 'aborted' }),
    }))
    expect(aborted.methods.interruptTurn).toHaveBeenCalledOnce()
  })

  it('rejects tool-result continuation explicitly', async () => {
    const fake = createFakeClient()
    const toolMessage = {
      ...userMessage('tool-result-1', ''),
      content: [{
        type: 'tool-result' as const,
        toolCallId: 'call-1' as never,
        content: [{ type: 'text' as const, text: 'result' }],
      }],
    }

    await expect(collect(createAdapter(fake).stream(generateOptions([toolMessage])))).rejects.toMatchObject({
      failure: { code: 'UNSUPPORTED_TOOL_CONTINUATION' },
    })
    expect(fake.methods.readAccount).not.toHaveBeenCalled()
  })

  it('ignores DSH tool definitions instead of bridging dynamic tools', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake)

    await collect(createAdapter(fake).stream({
      ...generateOptions(),
      tools: [{ name: 'dangerous', description: 'must not bridge', parameters: {} }],
    }))

    expect(JSON.stringify(fake.methods.startThread.mock.calls)).not.toContain('dynamicTools')
    expect(JSON.stringify(fake.methods.startTurn.mock.calls)).not.toContain('dangerous')
  })

  it('uses and discards an ephemeral thread without sessionId', async () => {
    const fake = createFakeClient()
    completeNextTurn(fake)
    const adapter = createAdapter(fake)
    const replayHistory = [
      userMessage('message-old', 'old prompt'),
      assistantMessage('message-assistant', CODEX_PROVIDER, {
        response: { version: 1, threadId: 'must-not-resume', turnId: 'turn-old' },
      }),
      userMessage('message-new', 'new prompt'),
    ]
    const { sessionId: _sessionId, ...ephemeralOptions } = generateOptions(replayHistory)
    await collect(adapter.stream(ephemeralOptions))
    completeNextTurn(fake)

    await collect(adapter.stream(ephemeralOptions))

    expect(fake.methods.startThread).toHaveBeenCalledTimes(2)
    expect(fake.methods.resumeThread).not.toHaveBeenCalled()
    expect(fake.methods.startThread).toHaveBeenCalledWith(
      expect.objectContaining({ ephemeral: true }),
      expect.any(Object),
    )
  })

  it('closes the owned client and forgets session state', async () => {
    const fake = createFakeClient()
    const adapter = createAdapter(fake)

    await adapter.close()

    expect(fake.methods.close).toHaveBeenCalledOnce()
  })
})
