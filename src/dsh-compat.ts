import type { ToolCallBlock } from '@deepseek-ai/dsh-llm'

/** The upstream call-id constructor was renamed in DSH 0.1.2. Its value is a string. */
export function toolCallId(value: string): ToolCallBlock['id'] {
  return value as ToolCallBlock['id']
}

/** Read a stable event snapshot through either supported DSH session API. */
export function sessionEvents(session: {
  readonly events?: readonly unknown[]
  snapshotEvents?(): readonly unknown[]
} | undefined): readonly unknown[] | undefined {
  return session?.snapshotEvents?.() ?? session?.events
}
