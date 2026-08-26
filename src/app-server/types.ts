export type JsonPrimitive = string | number | boolean | null

export type JsonValue = JsonPrimitive | JsonValue[] | JsonObject

export interface JsonObject {
  readonly [key: string]: JsonValue
}

export type JsonRpcId = number | string

export interface JsonRpcErrorPayload {
  readonly code: number
  readonly message: string
  readonly data?: JsonValue
}

export interface JsonRpcResponse {
  readonly id: JsonRpcId
  readonly result?: JsonValue
  readonly error?: JsonRpcErrorPayload
}

export interface AppServerClientInfo {
  readonly name: string
  readonly title: string | null
  readonly version: string
}

export interface AppServerInitializeResult {
  readonly userAgent: string
  readonly codexHome: string
  readonly platformFamily: string
  readonly platformOs: string
}

export type CodexAccountKind = 'apiKey' | 'chatgpt' | 'amazonBedrock'

export interface CodexAccountStatus {
  readonly authenticated: boolean
  readonly kind?: CodexAccountKind
  readonly requiresOpenaiAuth: boolean
}

export interface CodexReasoningEffort {
  readonly id: string
  readonly description: string
}

export interface CodexModel {
  readonly id: string
  readonly model: string
  readonly displayName: string
  readonly description: string
  readonly hidden: boolean
  readonly isDefault: boolean
  readonly inputModalities: readonly string[]
  readonly reasoningEfforts: readonly CodexReasoningEffort[]
  readonly defaultReasoningEffort: string
}

export interface CodexModelPage {
  readonly data: readonly CodexModel[]
  readonly nextCursor: string | null
}

export interface CodexThread {
  readonly id: string
}

export interface CodexTurn {
  readonly id: string
  readonly status: 'completed' | 'failed' | 'inProgress' | 'interrupted'
  readonly items: readonly CodexTurnItem[]
  readonly error: CodexTurnError | null
}

export interface CodexTurnItem {
  readonly type: string
  readonly text?: string
}

export interface CodexTurnError {
  readonly message: string
}

export interface CodexTokenUsageBreakdown {
  readonly totalTokens: number
  readonly inputTokens: number
  readonly cachedInputTokens: number
  readonly cacheWriteInputTokens: number
  readonly outputTokens: number
  readonly reasoningOutputTokens: number
}

export interface ThreadTokenUsageNotification {
  readonly method: 'thread/tokenUsage/updated'
  readonly params: {
    readonly threadId: string
    readonly turnId: string
    readonly last: CodexTokenUsageBreakdown
  }
}

export interface TextUserInput {
  readonly type: 'text'
  readonly text: string
  readonly text_elements?: readonly JsonObject[]
}

export interface ImageUserInput {
  readonly type: 'image'
  readonly url: string
}

export type CodexUserInput = TextUserInput | ImageUserInput

export type CodexSandboxMode = 'danger-full-access' | 'read-only' | 'workspace-write'

export interface CodexGranularApprovalPolicy {
  readonly granular: {
    readonly sandbox_approval: boolean
    readonly rules: boolean
    readonly skill_approval: boolean
    readonly request_permissions: boolean
    readonly mcp_elicitations: boolean
  }
}

export type CodexApprovalPolicy =
  | 'never'
  | 'on-request'
  | 'untrusted'
  | CodexGranularApprovalPolicy

export interface ExperimentalDynamicToolSpec {
  readonly type: 'function'
  readonly name: string
  readonly description: string
  readonly inputSchema: JsonObject
  readonly deferLoading?: boolean
}

export interface StartThreadOptions {
  readonly model?: string
  readonly cwd?: string
  readonly sandbox?: CodexSandboxMode
  readonly approvalPolicy?: CodexApprovalPolicy
  readonly baseInstructions?: string
  readonly developerInstructions?: string
  readonly ephemeral?: boolean
}

export interface ExperimentalStartThreadOptions extends StartThreadOptions {
  readonly dynamicTools: readonly ExperimentalDynamicToolSpec[]
}

export interface ResumeThreadOptions extends StartThreadOptions {
  readonly threadId: string
}

export interface StartTurnOptions {
  readonly threadId: string
  readonly input: readonly CodexUserInput[]
  readonly model?: string
  readonly effort?: string
}

export interface InterruptTurnOptions {
  readonly threadId: string
  readonly turnId: string
}

export interface AppServerNotification {
  readonly method: string
  readonly params?: JsonObject
  readonly emittedAtMs?: number
}

export interface AppServerRequest {
  readonly id: JsonRpcId
  readonly method: string
  readonly params?: JsonObject
}

export interface AgentMessageDeltaNotification {
  readonly method: 'item/agentMessage/delta'
  readonly params: {
    readonly threadId: string
    readonly turnId: string
    readonly itemId: string
    readonly delta: string
  }
}

export interface ReasoningDeltaNotification {
  readonly method:
    | 'item/reasoning/summaryTextDelta'
    | 'item/reasoning/textDelta'
  readonly params: {
    readonly threadId: string
    readonly turnId: string
    readonly itemId: string
    readonly delta: string
    readonly index: number
  }
}

export interface TurnCompletedNotification {
  readonly method: 'turn/completed'
  readonly params: {
    readonly threadId: string
    readonly turn: CodexTurn
  }
}

export type ParsedDeltaNotification =
  | AgentMessageDeltaNotification
  | ReasoningDeltaNotification
  | TurnCompletedNotification

export interface ExperimentalDynamicToolCall {
  readonly threadId: string
  readonly turnId: string
  readonly callId: string
  readonly namespace: string | null
  readonly tool: string
  readonly arguments: JsonValue
}

export interface ExperimentalDynamicToolOutputText {
  readonly type: 'inputText'
  readonly text: string
}

export interface ExperimentalDynamicToolOutputImage {
  readonly type: 'inputImage'
  readonly imageUrl: string
}

export interface ExperimentalDynamicToolOutputAudio {
  readonly type: 'inputAudio'
  readonly audioUrl: string
}

export type ExperimentalDynamicToolOutput =
  | ExperimentalDynamicToolOutputAudio
  | ExperimentalDynamicToolOutputImage
  | ExperimentalDynamicToolOutputText

export interface ExperimentalDynamicToolResult {
  readonly contentItems: readonly ExperimentalDynamicToolOutput[]
  readonly success: boolean
}

export type ExperimentalDynamicToolHandler = (
  call: ExperimentalDynamicToolCall,
  signal: AbortSignal,
) => Promise<ExperimentalDynamicToolResult>

export interface AppServerRequestOptions {
  readonly signal?: AbortSignal
  readonly timeoutMs?: number
}

export type ServerRequestHandler = (
  request: AppServerRequest,
  signal: AbortSignal,
) => Promise<JsonValue>
