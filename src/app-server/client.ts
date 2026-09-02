import { safeErrorMessage } from './redaction.js'
import type {
  AppServerClientInfo,
  AppServerInitializeResult,
  AppServerNotification,
  AppServerRequest,
  AppServerRequestOptions,
  CodexAccountStatus,
  CodexModel,
  CodexThread,
  CodexTurn,
  ExperimentalStartThreadOptions,
  InterruptTurnOptions,
  JsonObject,
  JsonRpcId,
  JsonValue,
  ExperimentalResumeThreadOptions,
  ResumeThreadOptions,
  ServerRequestHandler,
  StartThreadOptions,
  StartTurnOptions,
} from './types.js'
import {
  AppServerProtocolError,
  isJsonValue,
  isObject,
  parseAccountStatus,
  parseInitializeResult,
  parseJsonRpcResponse,
  parseModelPage,
  parseNotification,
  parseServerRequest,
  parseThread,
  parseTurn,
} from './validation.js'
import {
  ChildProcessTransport,
  type AppServerTransport,
  type ChildProcessTransportOptions,
} from './transport.js'

export { AppServerProtocolError } from './validation.js'

export type NotificationListener = (notification: AppServerNotification) => void

export interface AppServerClientOptions {
  readonly clientInfo?: AppServerClientInfo
  readonly experimentalApi?: boolean
  readonly requestTimeoutMs?: number
  readonly serverRequestTimeoutMs?: number
  readonly serverRequestHandler?: ServerRequestHandler
  readonly transport?: AppServerTransport
  readonly transportOptions?: ChildProcessTransportOptions
}

export interface ListModelsOptions extends AppServerRequestOptions {
  readonly includeHidden?: boolean
  readonly pageSize?: number
}

interface PendingRequest {
  readonly reject: (error: Error) => void
  readonly resolve: (value: JsonValue) => void
}

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const MAX_MODEL_PAGES = 100
const DEFAULT_CLIENT_INFO: AppServerClientInfo = {
  name: 'softspark_dsh_codex',
  title: 'SoftSpark DSH Codex',
  version: '1.1.0',
}

export class AppServerRpcError extends Error {
  readonly code: number

  constructor(code: number, message: string) {
    super(message)
    this.name = 'AppServerRpcError'
    this.code = code
  }
}

export class AppServerTimeoutError extends Error {
  constructor(method: string) {
    super(`Codex app-server request timed out: ${method}`)
    this.name = 'AppServerTimeoutError'
  }
}

export class AppServerAbortError extends Error {
  constructor() {
    super('Codex app-server request aborted')
    this.name = 'AbortError'
  }
}

export class AppServerClient {
  private readonly transport: AppServerTransport
  private readonly clientInfo: AppServerClientInfo
  private readonly experimentalApi: boolean
  private readonly requestTimeoutMs: number
  private readonly serverRequestTimeoutMs: number
  private readonly pending = new Map<JsonRpcId, PendingRequest>()
  private readonly listeners = new Set<NotificationListener>()
  private readonly serverRequests = new Set<AbortController>()

  private requestId = 0
  private startPromise?: Promise<AppServerInitializeResult>
  private closePromise?: Promise<void>
  private serverRequestHandler: ServerRequestHandler | undefined
  private closing = false
  private closed = false

  constructor(options: AppServerClientOptions = {}) {
    this.transport = options.transport ?? new ChildProcessTransport(options.transportOptions)
    this.clientInfo = options.clientInfo ?? DEFAULT_CLIENT_INFO
    this.experimentalApi = options.experimentalApi ?? false
    this.requestTimeoutMs = positiveInteger(
      options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
      'requestTimeoutMs',
    )
    this.serverRequestTimeoutMs = positiveInteger(
      options.serverRequestTimeoutMs ?? this.requestTimeoutMs,
      'serverRequestTimeoutMs',
    )
    this.serverRequestHandler = options.serverRequestHandler
  }

  start(): Promise<AppServerInitializeResult> {
    if (this.closed || this.closing) {
      return Promise.reject(new Error('Codex app-server client is closed'))
    }
    this.startPromise ??= this.startOnce()
    return this.startPromise
  }

  async request(
    method: string,
    params?: JsonObject,
    options: AppServerRequestOptions = {},
  ): Promise<JsonValue> {
    await this.start()
    return await this.requestRaw(method, params, options)
  }

  async notify(method: string, params?: JsonObject): Promise<void> {
    await this.start()
    await this.sendNotification(method, params)
  }

  onNotification(listener: NotificationListener): () => void {
    if (this.closed || this.closing) throw new Error('Codex app-server client is closed')
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  registerServerRequestHandler(handler: ServerRequestHandler): () => void {
    if (this.serverRequestHandler !== undefined) {
      throw new Error('Codex app-server server-request handler is already registered')
    }
    this.serverRequestHandler = handler
    return () => {
      if (this.serverRequestHandler === handler) this.serverRequestHandler = undefined
    }
  }

  async readAccount(options: AppServerRequestOptions = {}): Promise<CodexAccountStatus> {
    const result = await this.request('account/read', { refreshToken: false }, options)
    return parseAccountStatus(result)
  }

  async listModels(options: ListModelsOptions = {}): Promise<readonly CodexModel[]> {
    const pageSize = options.pageSize === undefined
      ? undefined
      : positiveInteger(options.pageSize, 'pageSize')
    const models: CodexModel[] = []
    const seenCursors = new Set<string>()
    let cursor: string | null | undefined

    for (let pageNumber = 0; pageNumber < MAX_MODEL_PAGES; pageNumber += 1) {
      const params: Record<string, JsonValue> = {}
      if (cursor !== undefined) params['cursor'] = cursor
      if (pageSize !== undefined) params['limit'] = pageSize
      if (options.includeHidden !== undefined) params['includeHidden'] = options.includeHidden
      const result = await this.request('model/list', params, options)
      const page = parseModelPage(result)
      models.push(...page.data)
      if (page.nextCursor === null) return models
      if (seenCursors.has(page.nextCursor)) {
        throw new AppServerProtocolError('model/list returned a repeated cursor')
      }
      seenCursors.add(page.nextCursor)
      cursor = page.nextCursor
    }
    throw new AppServerProtocolError('model/list exceeded the pagination limit')
  }

  async startThread(
    options: StartThreadOptions | ExperimentalStartThreadOptions,
    requestOptions: AppServerRequestOptions = {},
  ): Promise<CodexThread> {
    const result = await this.request(
      'thread/start',
      threadParams(options),
      requestOptions,
    )
    return parseThread(result)
  }

  async resumeThread(
    options: ResumeThreadOptions | ExperimentalResumeThreadOptions,
    requestOptions: AppServerRequestOptions = {},
  ): Promise<CodexThread> {
    const params: Record<string, JsonValue> = {
      ...threadParams(options),
      threadId: options.threadId,
    }
    const result = await this.request('thread/resume', params, requestOptions)
    return parseThread(result)
  }

  async startTurn(
    options: StartTurnOptions,
    requestOptions: AppServerRequestOptions = {},
  ): Promise<CodexTurn> {
    const params: Record<string, JsonValue> = {
      threadId: options.threadId,
      input: requireJsonValue(options.input, 'turn input'),
    }
    if (options.model !== undefined) params['model'] = options.model
    if (options.effort !== undefined) params['effort'] = options.effort
    const result = await this.request('turn/start', params, requestOptions)
    return parseTurn(result)
  }

  async interruptTurn(
    options: InterruptTurnOptions,
    requestOptions: AppServerRequestOptions = {},
  ): Promise<void> {
    await this.request(
      'turn/interrupt',
      { threadId: options.threadId, turnId: options.turnId },
      requestOptions,
    )
  }

  close(): Promise<void> {
    this.closePromise ??= this.closeOnce()
    return this.closePromise
  }

  private async startOnce(): Promise<AppServerInitializeResult> {
    await this.transport.start({
      onLine: (line) => this.onLine(line),
      onClose: (error) => this.onTransportClose(error),
    })
    try {
      const result = await this.requestRaw('initialize', {
        clientInfo: requireJsonValue(this.clientInfo, 'clientInfo'),
        capabilities: {
          experimentalApi: this.experimentalApi,
          requestAttestation: false,
        },
      })
      const initialized = parseInitializeResult(result)
      await this.sendNotification('initialized')
      return initialized
    } catch (error) {
      void this.close()
      throw error
    }
  }

  private requestRaw(
    method: string,
    params: JsonObject | undefined,
    options: AppServerRequestOptions = {},
  ): Promise<JsonValue> {
    if (this.closed || this.closing) {
      return Promise.reject(new Error('Codex app-server client is closed'))
    }
    if (method.length === 0) return Promise.reject(new Error('Request method must not be empty'))
    const timeoutMs = positiveInteger(
      options.timeoutMs ?? this.requestTimeoutMs,
      'timeoutMs',
    )
    if (options.signal?.aborted === true) {
      return Promise.reject(abortError(options.signal))
    }
    const id = this.nextRequestId()

    return new Promise<JsonValue>((resolve, reject) => {
      let settled = false
      const cleanup = (): void => {
        clearTimeout(timer)
        options.signal?.removeEventListener('abort', onAbort)
        this.pending.delete(id)
      }
      const settleResolve = (value: JsonValue): void => {
        if (settled) return
        settled = true
        cleanup()
        resolve(value)
      }
      const settleReject = (error: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        reject(error)
      }
      const onAbort = (): void => settleReject(abortError(options.signal))
      const timer = setTimeout(
        () => settleReject(new AppServerTimeoutError(method)),
        timeoutMs,
      )
      timer.unref()
      options.signal?.addEventListener('abort', onAbort, { once: true })
      this.pending.set(id, { resolve: settleResolve, reject: settleReject })

      const payload: Record<string, JsonValue> = { id, method }
      if (params !== undefined) payload['params'] = params
      void this.sendPayload(payload).catch((error: unknown) => {
        settleReject(new Error(safeErrorMessage(error)))
      })
    })
  }

  private async sendNotification(method: string, params?: JsonObject): Promise<void> {
    const payload: Record<string, JsonValue> = { method }
    if (params !== undefined) payload['params'] = params
    await this.sendPayload(payload)
  }

  private async sendPayload(payload: JsonObject): Promise<void> {
    await this.transport.send(JSON.stringify(payload))
  }

  private onLine(line: string): void {
    try {
      const value: unknown = JSON.parse(line)
      if (!isObject(value)) throw new AppServerProtocolError('app-server message must be an object')
      if (value['method'] !== undefined) {
        if (value['id'] === undefined) {
          this.publish(parseNotification(value['method'], value['params'], value['emittedAtMs']))
        } else {
          const request = parseServerRequest(
            value['id'],
            value['method'],
            value['params'],
          )
          void this.handleServerRequest(request).catch((error: unknown) => {
            const failure = new AppServerProtocolError(
              `App-server server-request response failed: ${safeErrorMessage(error)}`,
            )
            this.rejectPending(failure)
            void this.close().catch(() => {})
          })
        }
        return
      }
      const response = parseJsonRpcResponse(value)
      const pending = this.pending.get(response.id)
      if (pending === undefined) return
      if (response.error !== undefined) {
        pending.reject(new AppServerRpcError(response.error.code, response.error.message))
      } else {
        pending.resolve(response.result ?? null)
      }
    } catch (error) {
      this.rejectPending(new AppServerProtocolError(safeErrorMessage(error)))
      void this.close()
    }
  }

  private async handleServerRequest(request: AppServerRequest): Promise<void> {
    const controller = new AbortController()
    this.serverRequests.add(controller)
    try {
      const handler = this.serverRequestHandler
      if (handler === undefined) {
        await this.sendServerError(request.id, -32601, 'Server request is not supported')
        return
      }
      const result = await this.runServerRequestHandler(
        handler,
        request,
        controller,
      )
      if (!isJsonValue(result)) {
        throw new AppServerProtocolError('Server-request handler returned non-JSON data')
      }
      await this.sendPayload({ id: request.id, result })
    } catch (error) {
      if (!this.closed && !this.closing) {
        await this.sendServerError(request.id, -32000, safeErrorMessage(error))
      }
    } finally {
      this.serverRequests.delete(controller)
    }
  }

  private async runServerRequestHandler(
    handler: ServerRequestHandler,
    request: AppServerRequest,
    controller: AbortController,
  ): Promise<JsonValue> {
    return await new Promise<JsonValue>((resolve, reject) => {
      const timeout = setTimeout(() => {
        const failure = new Error('Codex app-server server request timed out')
        failure.name = 'AppServerTimeoutError'
        controller.abort(failure)
        reject(failure)
      }, this.serverRequestTimeoutMs)
      timeout.unref()
      void Promise.resolve()
        .then(() => handler(request, controller.signal))
        .then(resolve, reject)
        .finally(() => clearTimeout(timeout))
    })
  }

  private async sendServerError(id: JsonRpcId, code: number, message: string): Promise<void> {
    await this.sendPayload({ id, error: { code, message } })
  }

  private publish(notification: AppServerNotification): void {
    for (const listener of this.listeners) {
      try {
        listener(notification)
      } catch {
        // One consumer cannot break protocol processing for other subscribers.
      }
    }
  }

  private onTransportClose(error?: Error): void {
    this.closed = true
    this.closing = false
    const failure = error ?? new Error('Codex app-server transport closed')
    this.rejectPending(failure)
    for (const controller of this.serverRequests) controller.abort(failure)
    this.serverRequests.clear()
    this.listeners.clear()
  }

  private rejectPending(error: Error): void {
    for (const pending of [...this.pending.values()]) pending.reject(error)
  }

  private nextRequestId(): number {
    if (this.requestId >= Number.MAX_SAFE_INTEGER) {
      if (this.pending.size > 0) throw new Error('JSON-RPC request id space exhausted')
      this.requestId = 0
    }
    this.requestId += 1
    return this.requestId
  }

  private async closeOnce(): Promise<void> {
    if (this.closed) return
    this.closing = true
    const failure = new Error('Codex app-server client closed')
    this.rejectPending(failure)
    for (const controller of this.serverRequests) controller.abort(failure)
    this.serverRequests.clear()
    this.listeners.clear()
    await this.transport.close()
    this.closed = true
    this.closing = false
  }
}

function threadParams(
  options:
    | StartThreadOptions
    | ExperimentalStartThreadOptions
    | ResumeThreadOptions
    | ExperimentalResumeThreadOptions,
): JsonObject {
  const params: Record<string, JsonValue> = {}
  if (options.model !== undefined) params['model'] = options.model
  if (options.cwd !== undefined) params['cwd'] = options.cwd
  if (options.sandbox !== undefined) params['sandbox'] = options.sandbox
  if (options.approvalPolicy !== undefined) {
    params['approvalPolicy'] = requireJsonValue(options.approvalPolicy, 'approvalPolicy')
  }
  if (options.baseInstructions !== undefined) {
    params['baseInstructions'] = options.baseInstructions
  }
  if (options.developerInstructions !== undefined) {
    params['developerInstructions'] = options.developerInstructions
  }
  if (options.ephemeral !== undefined) params['ephemeral'] = options.ephemeral
  if ('dynamicTools' in options) {
    params['dynamicTools'] = requireJsonValue(options.dynamicTools, 'dynamicTools')
  }
  return params
}

function requireJsonValue(value: unknown, label: string): JsonValue {
  if (!isJsonValue(value)) throw new AppServerProtocolError(`${label} must be JSON`)
  return value
}

function abortError(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error ? signal.reason : new AppServerAbortError()
}

function positiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer`)
  }
  return value
}
