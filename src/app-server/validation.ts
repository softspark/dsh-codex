import type {
  AppServerInitializeResult,
  AppServerNotification,
  AppServerRequest,
  AgentMessageDeltaNotification,
  CodexAccountStatus,
  CodexModel,
  CodexThread,
  CodexTurn,
  CodexTokenUsageBreakdown,
  ExperimentalDynamicToolCall,
  JsonObject,
  JsonRpcId,
  JsonRpcErrorPayload,
  JsonRpcResponse,
  JsonValue,
  ParsedDeltaNotification,
  ReasoningDeltaNotification,
  TurnCompletedNotification,
  ThreadTokenUsageNotification,
} from './types.js'
import { redactJsonValue, redactSensitive } from './redaction.js'

export class AppServerProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AppServerProtocolError'
  }
}

export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (value === null) return true
  if (typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value['every'](isJsonValue)
  if (!isObject(value)) return false
  return Object.values(value).every(isJsonValue)
}

export function asJsonObject(value: unknown, label: string): JsonObject {
  if (!isObject(value) || !isJsonValue(value)) {
    throw new AppServerProtocolError(`${label} must be a JSON object`)
  }
  return value
}

export function asNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value['length'] === 0) {
    throw new AppServerProtocolError(`${label} must be a non-empty string`)
  }
  return value
}

function asBoolean(value: unknown, label: string): boolean {
  if (typeof value !== 'boolean') {
    throw new AppServerProtocolError(`${label} must be a boolean`)
  }
  return value
}

function asStringArray(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value) || !value['every']((entry) => typeof entry === 'string')) {
    throw new AppServerProtocolError(`${label} must be an array of strings`)
  }
  return value
}

export function asJsonRpcId(value: unknown): JsonRpcId {
  if (typeof value === 'string' && value['length'] > 0) return value
  if (typeof value === 'number' && Number.isSafeInteger(value)) return value
  throw new AppServerProtocolError('JSON-RPC id must be a safe integer or non-empty string')
}

export function parseInitializeResult(value: unknown): AppServerInitializeResult {
  const result = asJsonObject(value, 'initialize result')
  return {
    userAgent: asNonEmptyString(result['userAgent'], 'initialize.userAgent'),
    codexHome: asNonEmptyString(result['codexHome'], 'initialize.codexHome'),
    platformFamily: asNonEmptyString(result['platformFamily'], 'initialize.platformFamily'),
    platformOs: asNonEmptyString(result['platformOs'], 'initialize.platformOs'),
  }
}

export function parseAccountStatus(value: unknown): CodexAccountStatus {
  const result = asJsonObject(value, 'account/read result')
  const requiresOpenaiAuth = asBoolean(
    result['requiresOpenaiAuth'],
    'account.requiresOpenaiAuth',
  )
  if (result['account'] === null) return { authenticated: false, requiresOpenaiAuth }
  const account = asJsonObject(result['account'], 'account')
  const kind = asNonEmptyString(account['type'], 'account.type')
  if (kind !== 'apiKey' && kind !== 'chatgpt' && kind !== 'amazonBedrock') {
    throw new AppServerProtocolError('account.type is unsupported')
  }
  return { authenticated: true, kind, requiresOpenaiAuth }
}

function parseReasoningEfforts(value: unknown): CodexModel['reasoningEfforts'] {
  if (!Array.isArray(value)) {
    throw new AppServerProtocolError('model.supportedReasoningEfforts must be an array')
  }
  return value['map']((entry, index) => {
    const effort = asJsonObject(entry, `model.reasoningEfforts[${index}]`)
    return {
      id: asNonEmptyString(effort['reasoningEffort'], 'reasoningEffort.id'),
      description:
        typeof effort['description'] === 'string' ? effort['description'] : '',
    }
  })
}

function parseModel(value: unknown, index: number): CodexModel {
  const model = asJsonObject(value, `model/list.data[${index}]`)
  return {
    id: asNonEmptyString(model['id'], 'model.id'),
    model: asNonEmptyString(model['model'], 'model.model'),
    displayName: asNonEmptyString(model['displayName'], 'model.displayName'),
    description: typeof model['description'] === 'string' ? model['description'] : '',
    hidden: asBoolean(model['hidden'], 'model.hidden'),
    isDefault: asBoolean(model['isDefault'], 'model.isDefault'),
    inputModalities: model['inputModalities'] === undefined
      ? ['text', 'image']
      : asStringArray(model['inputModalities'], 'model.inputModalities'),
    reasoningEfforts: parseReasoningEfforts(model['supportedReasoningEfforts']),
    defaultReasoningEffort: asNonEmptyString(
      model['defaultReasoningEffort'],
      'model.defaultReasoningEffort',
    ),
  }
}

export interface ModelPage {
  readonly data: readonly CodexModel[]
  readonly nextCursor: string | null
}

export function parseModelPage(value: unknown): ModelPage {
  const result = asJsonObject(value, 'model/list result')
  if (!Array.isArray(result['data'])) {
    throw new AppServerProtocolError('model/list.data must be an array')
  }
  if (result['nextCursor'] !== null && typeof result['nextCursor'] !== 'string') {
    throw new AppServerProtocolError('model/list.nextCursor must be a string or null')
  }
  return {
    data: result['data'].map(parseModel),
    nextCursor: result['nextCursor'],
  }
}

export function parseThread(value: unknown): CodexThread {
  const result = asJsonObject(value, 'thread result')
  const thread = asJsonObject(result['thread'], 'thread')
  return {
    id: asNonEmptyString(thread['id'], 'thread.id'),
  }
}

export function parseTurn(value: unknown): CodexTurn {
  const result = asJsonObject(value, 'turn result')
  const turn = asJsonObject(result['turn'], 'turn')
  const status = asNonEmptyString(turn['status'], 'turn.status')
  if (
    status !== 'completed' &&
    status !== 'failed' &&
    status !== 'inProgress' &&
    status !== 'interrupted'
  ) {
    throw new AppServerProtocolError('turn.status is unsupported')
  }
  const rawItems = turn['items']
  if (rawItems !== undefined && !Array.isArray(rawItems)) {
    throw new AppServerProtocolError('turn.items must be an array when present')
  }
  const items = (rawItems ?? []).map((entry, index) => {
    const item = asJsonObject(entry, `turn.items[${index}]`)
    const type = asNonEmptyString(item['type'], 'turn.item.type')
    if (item['text'] !== undefined && typeof item['text'] !== 'string') {
      throw new AppServerProtocolError('turn.item.text must be a string when present')
    }
    return {
      type,
      ...(item['text'] === undefined ? {} : { text: item['text'] }),
    }
  })
  const rawError = turn['error']
  const parsedError = rawError === undefined || rawError === null
    ? null
    : {
        message: asNonEmptyString(
          asJsonObject(rawError, 'turn.error')['message'],
          'turn.error.message',
        ),
      }
  return {
    id: asNonEmptyString(turn['id'], 'turn.id'),
    status,
    items,
    error: parsedError,
  }
}

function parseUsageBreakdown(value: unknown): CodexTokenUsageBreakdown {
  const usage = asJsonObject(value, 'token usage breakdown')
  const read = (field: keyof CodexTokenUsageBreakdown): number => {
    const count = usage[field]
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new AppServerProtocolError(`token usage ${field} must be a non-negative integer`)
    }
    return count
  }
  return {
    totalTokens: read('totalTokens'),
    inputTokens: read('inputTokens'),
    cachedInputTokens: read('cachedInputTokens'),
    cacheWriteInputTokens: read('cacheWriteInputTokens'),
    outputTokens: read('outputTokens'),
    reasoningOutputTokens: read('reasoningOutputTokens'),
  }
}

export function parseTokenUsageNotification(
  method: string,
  params: unknown,
): ThreadTokenUsageNotification {
  if (method !== 'thread/tokenUsage/updated') {
    throw new AppServerProtocolError(`unsupported token usage method: ${method}`)
  }
  const value = asJsonObject(params, 'thread token usage notification')
  const tokenUsage = asJsonObject(value['tokenUsage'], 'thread token usage')
  return {
    method,
    params: {
      threadId: asNonEmptyString(value['threadId'], 'usage.threadId'),
      turnId: asNonEmptyString(value['turnId'], 'usage.turnId'),
      last: parseUsageBreakdown(tokenUsage['last']),
    },
  }
}

export function parseNotification(
  method: unknown,
  params: unknown,
  emittedAtMs: unknown,
): AppServerNotification {
  const notification: AppServerNotification = {
    method: asNonEmptyString(method, 'notification.method'),
    ...(params === undefined ? {} : { params: asJsonObject(params, 'notification.params') }),
    ...(emittedAtMs === undefined
      ? {}
      : {
          emittedAtMs:
            typeof emittedAtMs === 'number' && Number.isFinite(emittedAtMs)
              ? emittedAtMs
              : (() => {
                  throw new AppServerProtocolError(
                    'notification.emittedAtMs must be a finite number',
                  )
                })(),
        }),
  }
  return notification
}

export function parseServerRequest(
  id: unknown,
  method: unknown,
  params: unknown,
): AppServerRequest {
  return {
    id: asJsonRpcId(id),
    method: asNonEmptyString(method, 'request.method'),
    ...(params === undefined ? {} : { params: asJsonObject(params, 'request.params') }),
  }
}

function parseJsonRpcError(value: unknown): JsonRpcErrorPayload {
  const error = asJsonObject(value, 'JSON-RPC error')
  if (typeof error['code'] !== 'number' || !Number.isSafeInteger(error['code'])) {
    throw new AppServerProtocolError('JSON-RPC error.code must be a safe integer')
  }
  return {
    code: error['code'],
    message: redactSensitive(asNonEmptyString(error['message'], 'JSON-RPC error.message')),
    ...(error['data'] === undefined ? {} : { data: redactJsonValue(error['data']) }),
  }
}

export function parseJsonRpcResponse(value: unknown): JsonRpcResponse {
  const response = asJsonObject(value, 'JSON-RPC response')
  if (response['jsonrpc'] !== undefined && response['jsonrpc'] !== '2.0') {
    throw new AppServerProtocolError('JSON-RPC version must be 2.0 when present')
  }
  const hasResult = Object.hasOwn(response, 'result')
  const hasError = Object.hasOwn(response, 'error')
  if (hasResult === hasError) {
    throw new AppServerProtocolError(
      'JSON-RPC response must contain exactly one of result or error',
    )
  }
  const id = asJsonRpcId(response['id'])
  if (hasError) return { id, error: parseJsonRpcError(response['error']) }
  if (!isJsonValue(response['result'])) {
    throw new AppServerProtocolError('JSON-RPC result must be valid JSON')
  }
  return { id, result: response['result'] }
}

function parseDeltaBase(params: unknown): {
  readonly threadId: string
  readonly turnId: string
  readonly itemId: string
  readonly delta: string
} {
  const value = asJsonObject(params, 'delta notification')
  return {
    threadId: asNonEmptyString(value['threadId'], 'delta.threadId'),
    turnId: asNonEmptyString(value['turnId'], 'delta.turnId'),
    itemId: asNonEmptyString(value['itemId'], 'delta.itemId'),
    delta: typeof value['delta'] === 'string'
      ? value['delta']
      : (() => {
          throw new AppServerProtocolError('delta.delta must be a string')
        })(),
  }
}

export function parseDeltaNotification(
  method: string,
  params: unknown,
): ParsedDeltaNotification {
  if (method === 'item/agentMessage/delta') {
    const notification: AgentMessageDeltaNotification = {
      method,
      params: parseDeltaBase(params),
    }
    return notification
  }
  if (
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/textDelta'
  ) {
    const value = asJsonObject(params, 'reasoning delta')
    const rawIndex = method === 'item/reasoning/summaryTextDelta'
      ? value['summaryIndex']
      : value['contentIndex']
    if (typeof rawIndex !== 'number' || !Number.isSafeInteger(rawIndex) || rawIndex < 0) {
      throw new AppServerProtocolError('reasoning delta index must be a non-negative integer')
    }
    const notification: ReasoningDeltaNotification = {
      method,
      params: { ...parseDeltaBase(value), index: rawIndex },
    }
    return notification
  }
  if (method === 'turn/completed') {
    const value = asJsonObject(params, 'turn/completed notification')
    const notification: TurnCompletedNotification = {
      method,
      params: {
        threadId: asNonEmptyString(value['threadId'], 'turn.threadId'),
        turn: parseTurn({ turn: value['turn'] }),
      },
    }
    return notification
  }
  throw new AppServerProtocolError(`unsupported delta notification method: ${method}`)
}

export function parseExperimentalDynamicToolCall(
  params: unknown,
): ExperimentalDynamicToolCall {
  const call = asJsonObject(params, 'dynamic tool call')
  return {
    threadId: asNonEmptyString(call['threadId'], 'dynamicTool.threadId'),
    turnId: asNonEmptyString(call['turnId'], 'dynamicTool.turnId'),
    callId: asNonEmptyString(call['callId'], 'dynamicTool.callId'),
    namespace:
      call['namespace'] === null
        ? null
        : asNonEmptyString(call['namespace'], 'dynamicTool.namespace'),
    tool: asNonEmptyString(call['tool'], 'dynamicTool.tool'),
    arguments: isJsonValue(call['arguments'])
      ? call['arguments']
      : (() => {
          throw new AppServerProtocolError('dynamicTool.arguments must be JSON')
        })(),
  }
}
