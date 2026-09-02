import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

import {
  CODEX_PROVIDER,
  CodexAdapter,
  MAX_DYNAMIC_TOOL_ARGUMENT_BYTES,
  MAX_DYNAMIC_TOOL_CALL_ID_BYTES,
  MAX_DYNAMIC_TOOL_CALLS_PER_TURN,
  MAX_DYNAMIC_TOOL_CATALOG_BYTES,
  MAX_DYNAMIC_TOOL_DESCRIPTION_BYTES,
  MAX_DYNAMIC_TOOL_NAME_BYTES,
  MAX_DYNAMIC_TOOL_RESULT_BYTES,
  MAX_DYNAMIC_TOOL_SCHEMA_BYTES,
  MAX_DYNAMIC_TOOLS,
  MAX_PENDING_DYNAMIC_TOOL_CALLS,
  type CodexAdapterOptions,
} from './adapter.js'
import { AppServerClient } from './app-server/client.js'
import { ChildProcessTransport } from './app-server/transport.js'
import type {
  CodexApprovalPolicy,
  CodexSandboxMode,
} from './app-server/types.js'

export const name = 'dsh-codex'
export const inject = ['llm']

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000
const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000
export const DEFAULT_DYNAMIC_TOOL_TIMEOUT_MS = 10 * 60_000
const MAX_REQUEST_TIMEOUT_MS = 5 * 60_000
const MAX_TURN_TIMEOUT_MS = 60 * 60_000
export const MAX_DYNAMIC_TOOL_TIMEOUT_MS = 60 * 60_000
const CHILD_ENVIRONMENT_KEYS = new Set([
  'ALL_PROXY',
  'APPDATA',
  'CODEX_CA_CERTIFICATE',
  'CODEX_HOME',
  'CLICOLOR',
  'CLICOLOR_FORCE',
  'COLORTERM',
  'COMSPEC',
  'FORCE_COLOR',
  'HOMEDRIVE',
  'HOMEPATH',
  'HOME',
  'HTTPS_PROXY',
  'HTTP_PROXY',
  'LANG',
  'LOCALAPPDATA',
  'LOGNAME',
  'NODE_EXTRA_CA_CERTS',
  'NO_COLOR',
  'NO_PROXY',
  'PATH',
  'PATHEXT',
  'SHELL',
  'SSL_CERT_DIR',
  'SSL_CERT_FILE',
  'SYSTEMROOT',
  'TEMP',
  'TERM',
  'TERM_PROGRAM',
  'TMP',
  'TMPDIR',
  'USER',
  'USERNAME',
  'USERPROFILE',
  'WINDIR',
  'WSL_DISTRO_NAME',
  'WSL_INTEROP',
  'WSLENV',
  'XDG_CACHE_HOME',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_RUNTIME_DIR',
  'XDG_STATE_HOME',
  'all_proxy',
  'http_proxy',
  'https_proxy',
  'no_proxy',
])

export interface Config {
  readonly provider?: 'codex'
  readonly command?: string
  readonly cwd?: string
  readonly sandbox?: CodexSandboxMode
  readonly approvalPolicy?: 'never' | 'on-request' | 'untrusted'
  readonly allowApiKeyAuth?: boolean
  readonly experimentalDynamicTools?: boolean
  readonly dynamicToolTimeoutMs?: number
  readonly requestTimeoutMs?: number
  readonly turnTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  provider: z.const(CODEX_PROVIDER).default(CODEX_PROVIDER),
  command: z.string().default('codex'),
  cwd: z.string(),
  sandbox: z.union([
    z.const('read-only'),
    z.const('workspace-write'),
    z.const('danger-full-access'),
  ]).default('workspace-write'),
  approvalPolicy: z.union([
    z.const('never'),
    z.const('on-request'),
    z.const('untrusted'),
  ]).default('untrusted'),
  allowApiKeyAuth: z.boolean().default(false),
  experimentalDynamicTools: z.boolean().default(false),
  dynamicToolTimeoutMs: z.number()
    .min(1_000)
    .max(MAX_DYNAMIC_TOOL_TIMEOUT_MS)
    .default(DEFAULT_DYNAMIC_TOOL_TIMEOUT_MS),
  requestTimeoutMs: z.number()
    .min(1_000)
    .max(MAX_REQUEST_TIMEOUT_MS)
    .default(DEFAULT_REQUEST_TIMEOUT_MS),
  turnTimeoutMs: z.number()
    .min(1_000)
    .max(MAX_TURN_TIMEOUT_MS)
    .default(DEFAULT_TURN_TIMEOUT_MS),
})

export interface ResolvedConfig {
  readonly provider: 'codex'
  readonly command: string
  readonly cwd: string
  readonly sandbox: CodexSandboxMode
  readonly approvalPolicy: CodexApprovalPolicy
  readonly allowApiKeyAuth: boolean
  readonly experimentalDynamicTools: boolean
  readonly dynamicToolTimeoutMs: number
  readonly requestTimeoutMs: number
  readonly turnTimeoutMs: number
}

export function resolveConfig(config: Config = {}): ResolvedConfig {
  const provider = config.provider ?? CODEX_PROVIDER
  if (provider !== CODEX_PROVIDER) {
    throw new TypeError(`provider must be "${CODEX_PROVIDER}"`)
  }
  const command = config.command ?? 'codex'
  if (command.trim().length === 0) throw new TypeError('command must not be empty')
  const cwd = config.cwd ?? process.cwd()
  if (cwd.trim().length === 0) throw new TypeError('cwd must not be empty')
  const requestTimeoutMs = boundedInteger(
    config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS,
    'requestTimeoutMs',
    MAX_REQUEST_TIMEOUT_MS,
  )
  const turnTimeoutMs = boundedInteger(
    config.turnTimeoutMs ?? DEFAULT_TURN_TIMEOUT_MS,
    'turnTimeoutMs',
    MAX_TURN_TIMEOUT_MS,
  )
  const dynamicToolTimeoutMs = boundedInteger(
    config.dynamicToolTimeoutMs ?? DEFAULT_DYNAMIC_TOOL_TIMEOUT_MS,
    'dynamicToolTimeoutMs',
    MAX_DYNAMIC_TOOL_TIMEOUT_MS,
  )
  return {
    provider,
    command,
    cwd,
    sandbox: config.sandbox ?? 'workspace-write',
    approvalPolicy: config.approvalPolicy ?? 'untrusted',
    allowApiKeyAuth: config.allowApiKeyAuth ?? false,
    experimentalDynamicTools: config.experimentalDynamicTools ?? false,
    dynamicToolTimeoutMs,
    requestTimeoutMs,
    turnTimeoutMs,
  }
}

export function apply(ctx: Context, config: Config = {}): void {
  const resolved = resolveConfig(config)
  const transport = new ChildProcessTransport({
    command: resolved.command,
    cwd: resolved.cwd,
    env: childEnvironment(resolved.allowApiKeyAuth),
  })
  const client = new AppServerClient({
    transport,
    experimentalApi: resolved.experimentalDynamicTools,
    requestTimeoutMs: resolved.requestTimeoutMs,
    serverRequestTimeoutMs: resolved.experimentalDynamicTools
      ? resolved.dynamicToolTimeoutMs
      : resolved.requestTimeoutMs,
  })
  const adapterOptions: CodexAdapterOptions = {
    client,
    provider: resolved.provider,
    cwd: resolved.cwd,
    sandbox: resolved.sandbox,
    approvalPolicy: resolved.approvalPolicy,
    allowApiKeyAuth: resolved.allowApiKeyAuth,
    experimentalDynamicTools: resolved.experimentalDynamicTools,
    // Resolved per request rather than captured here: `ctx.attachments` is a
    // cordis service that may be installed after this plugin is applied.
    attachments: () => ctx.attachments,
    requestTimeoutMs: resolved.requestTimeoutMs,
    turnTimeoutMs: resolved.turnTimeoutMs,
  }
  const adapter = new CodexAdapter(adapterOptions)
  ctx.effect(
    () => {
      const unregister = ctx.llm.registerAdapter([resolved.provider], adapter)
      return async () => {
        unregister()
        await adapter.close()
      }
    },
    'dsh-codex: register adapter and own app-server client',
  )
}

export function childEnvironment(
  _allowApiKeyAuth: boolean,
  source: Readonly<NodeJS.ProcessEnv> = process.env,
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {}
  for (const [variable, value] of Object.entries(source)) {
    const normalizedVariable = variable.toUpperCase()
    if (
      !CHILD_ENVIRONMENT_KEYS.has(normalizedVariable)
      && !normalizedVariable.startsWith('LC_')
    ) continue
    environment[variable] = value
  }
  return environment
}

function boundedInteger(value: number, name: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1000 and ${maximum}`)
  }
  return value
}

export {
  CODEX_PROVIDER,
  CodexAdapter,
  MAX_DYNAMIC_TOOL_ARGUMENT_BYTES,
  MAX_DYNAMIC_TOOL_CALL_ID_BYTES,
  MAX_DYNAMIC_TOOL_CALLS_PER_TURN,
  MAX_DYNAMIC_TOOL_CATALOG_BYTES,
  MAX_DYNAMIC_TOOL_DESCRIPTION_BYTES,
  MAX_DYNAMIC_TOOL_NAME_BYTES,
  MAX_DYNAMIC_TOOL_RESULT_BYTES,
  MAX_DYNAMIC_TOOL_SCHEMA_BYTES,
  MAX_DYNAMIC_TOOLS,
  MAX_PENDING_DYNAMIC_TOOL_CALLS,
}
export type { CodexAdapterOptions }
export {
  AppServerAbortError,
  AppServerClient,
  AppServerRpcError,
  AppServerTimeoutError,
} from './app-server/client.js'
export type {
  AppServerClientOptions,
  ListModelsOptions,
  NotificationListener,
} from './app-server/client.js'
export {
  ChildProcessTransport,
} from './app-server/transport.js'
export type {
  AppServerTransport,
  ChildProcessTransportOptions,
  SpawnFactory,
  TransportHandlers,
} from './app-server/transport.js'
export type * from './app-server/types.js'
export {
  AppServerProtocolError,
  asJsonObject,
  asJsonRpcId,
  asNonEmptyString,
  isJsonValue,
  isObject,
  parseAccountStatus,
  parseDeltaNotification,
  parseExperimentalDynamicToolCall,
  parseInitializeResult,
  parseJsonRpcResponse,
  parseModelPage,
  parseNotification,
  parseServerRequest,
  parseThread,
  parseTokenUsageNotification,
  parseTurn,
} from './app-server/validation.js'
export {
  redactJsonValue,
  redactSensitive,
  safeErrorMessage,
} from './app-server/redaction.js'
