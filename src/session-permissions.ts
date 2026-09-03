import type {
  CodexApprovalPolicy,
  CodexSandboxMode,
} from './app-server/types.js'

export interface CodexThreadPermissions {
  readonly sandbox: CodexSandboxMode
  readonly approvalPolicy: CodexApprovalPolicy
}

/**
 * Apply explicit DSH session overrides to the static Codex fallback.
 *
 * The DSH `never` approval policy maps directly to Codex `never`. The
 * interactive DSH `ask` policy does not: app-server approvals have a separate
 * UI path, so the configured Codex fallback remains authoritative.
 */
export function resolveSessionPermissions(
  fallback: CodexThreadPermissions,
  events: readonly unknown[] | undefined,
): CodexThreadPermissions {
  if (events === undefined) return fallback

  let sandbox: CodexSandboxMode | undefined
  let approvalPolicy: CodexApprovalPolicy | undefined
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (!isRecord(event)) continue
    const data = event['data']
    if (!isRecord(data)) continue

    if (sandbox === undefined && event['type'] === 'sandbox/mode') {
      const mode = data['mode']
      if (isSandboxMode(mode)) sandbox = mode
    }
    if (approvalPolicy === undefined && event['type'] === 'approval/policy') {
      if (data['policy'] === 'never') approvalPolicy = 'never'
    }
    if (sandbox !== undefined && approvalPolicy !== undefined) break
  }

  if (sandbox === undefined && approvalPolicy === undefined) return fallback
  return {
    sandbox: sandbox ?? fallback.sandbox,
    approvalPolicy: approvalPolicy ?? fallback.approvalPolicy,
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isSandboxMode(value: unknown): value is CodexSandboxMode {
  return value === 'read-only'
    || value === 'workspace-write'
    || value === 'danger-full-access'
}
