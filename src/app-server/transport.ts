import {
  spawn,
  type ChildProcessWithoutNullStreams,
  type SpawnOptions,
} from 'node:child_process'
import { TextDecoder } from 'node:util'

import { redactSensitive, safeErrorMessage } from './redaction.js'
import { isObject } from './validation.js'

export interface TransportHandlers {
  readonly onLine: (line: string) => void
  readonly onClose: (error?: Error) => void
}

export interface AppServerTransport {
  start(handlers: TransportHandlers): Promise<void>
  send(line: string): Promise<void>
  close(): Promise<void>
}

export type SpawnFactory = (
  command: string,
  args: string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams

export interface ChildProcessTransportOptions {
  readonly command?: string
  readonly cwd?: string
  readonly env?: Readonly<NodeJS.ProcessEnv>
  readonly maxLineBytes?: number
  readonly maxStderrBytes?: number
  readonly shutdownTimeoutMs?: number
  readonly spawnFactory?: SpawnFactory
}

const DEFAULT_MAX_LINE_BYTES = 8 * 1024 * 1024
const DEFAULT_MAX_STDERR_BYTES = 64 * 1024
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 5_000
const MIN_LINE_BYTES = 1_024

export class ChildProcessTransport implements AppServerTransport {
  private readonly command: string
  private readonly cwd: string | undefined
  private readonly env: Readonly<NodeJS.ProcessEnv> | undefined
  private readonly maxLineBytes: number
  private readonly maxStderrBytes: number
  private readonly shutdownTimeoutMs: number
  private readonly spawnFactory: SpawnFactory
  private readonly decoder = new TextDecoder('utf-8', { fatal: true })

  private child?: ChildProcessWithoutNullStreams
  private handlers: TransportHandlers | undefined
  private lineBuffer = Buffer.alloc(0)
  private stderrBuffer = Buffer.alloc(0)
  private started = false
  private closed = false
  private closing = false
  private closePromise: Promise<void> | undefined
  private closeError: Error | undefined
  private closeNotified = false
  private processExited = false
  private stdinEnded = false
  private exitPromise?: Promise<void>
  private resolveExit?: () => void

  constructor(options: ChildProcessTransportOptions = {}) {
    this.command = options.command ?? 'codex'
    this.cwd = options.cwd
    this.env = options.env
    this.maxLineBytes = positiveInteger(
      options.maxLineBytes ?? DEFAULT_MAX_LINE_BYTES,
      'maxLineBytes',
      MIN_LINE_BYTES,
    )
    this.maxStderrBytes = positiveInteger(
      options.maxStderrBytes ?? DEFAULT_MAX_STDERR_BYTES,
      'maxStderrBytes',
      1,
    )
    this.shutdownTimeoutMs = positiveInteger(
      options.shutdownTimeoutMs ?? DEFAULT_SHUTDOWN_TIMEOUT_MS,
      'shutdownTimeoutMs',
      1,
    )
    this.spawnFactory = options.spawnFactory ?? spawnProcess
  }

  async start(handlers: TransportHandlers): Promise<void> {
    if (this.started) throw new Error('Codex app-server transport already started')
    this.started = true
    this.handlers = handlers
    this.exitPromise = new Promise((resolve) => {
      this.resolveExit = resolve
    })

    let child: ChildProcessWithoutNullStreams
    try {
      child = this.spawnFactory(
        this.command,
        ['app-server', '--listen', 'stdio://'],
        {
          cwd: this.cwd,
          env: this.env === undefined ? process.env : { ...this.env },
          shell: false,
          stdio: ['pipe', 'pipe', 'pipe'],
          windowsHide: true,
        },
      )
    } catch {
      this.finish(new Error('Failed to spawn Codex app-server'))
      throw new Error('Failed to spawn Codex app-server')
    }

    this.child = child
    child.stdout.on('data', this.onStdout)
    child.stderr.on('data', this.onStderr)
    child.once('error', this.onProcessError)
    child.once('exit', this.onProcessExit)
  }

  async send(line: string): Promise<void> {
    const child = this.child
    if (child === undefined || this.closed || this.closing) {
      throw new Error('Codex app-server transport is not writable')
    }
    if (line.includes('\n') || line.includes('\r')) {
      throw new Error('App-server transport accepts exactly one JSONL line')
    }
    if (Buffer.byteLength(line, 'utf8') > this.maxLineBytes) {
      throw new Error('Outbound app-server message exceeds maxLineBytes')
    }

    await new Promise<void>((resolve, reject) => {
      let callbackDone = false
      let drained = true
      let settled = false

      const cleanup = (): void => {
        child.stdin.off('drain', onDrain)
        child.stdin.off('error', onError)
        child.stdin.off('close', onClose)
      }
      const settle = (error?: Error): void => {
        if (settled) return
        settled = true
        cleanup()
        if (error === undefined) resolve()
        else reject(error)
      }
      const maybeResolve = (): void => {
        if (callbackDone && drained) settle()
      }
      const onDrain = (): void => {
        drained = true
        maybeResolve()
      }
      const onError = (): void => settle(new Error('Failed to write to Codex app-server'))
      const onClose = (): void => settle(new Error('Codex app-server stdin closed'))

      child.stdin.once('error', onError)
      child.stdin.once('close', onClose)
      const accepted = child.stdin.write(`${line}\n`, 'utf8', (error) => {
        if (error !== null && error !== undefined) {
          settle(new Error('Failed to write to Codex app-server'))
          return
        }
        callbackDone = true
        maybeResolve()
      })
      if (!accepted) {
        drained = false
        child.stdin.once('drain', onDrain)
      }
    })
  }

  close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise
    if (!this.started || this.closed) return Promise.resolve()
    this.closing = true
    this.closePromise = this.terminate()
    return this.closePromise
  }

  private readonly onStdout = (chunk: Buffer): void => {
    if (this.closed || this.closing) return
    this.consumeChunk(chunk)
  }

  private readonly onStderr = (chunk: Buffer): void => {
    if (this.closed || chunk.byteLength === 0) return
    const combined = Buffer.concat([this.stderrBuffer, chunk])
    this.stderrBuffer = combined.subarray(
      Math.max(0, combined.byteLength - this.maxStderrBytes),
    )
  }

  private readonly onProcessError = (): void => {
    this.failProcess(this.exitError('Codex app-server process error'))
  }

  private readonly onProcessExit = (
    code: number | null,
    signal: NodeJS.Signals | null,
  ): void => {
    this.processExited = true
    this.resolveExit?.()
    if (this.closing) {
      this.finish()
      return
    }
    const status = signal === null ? `code ${String(code)}` : `signal ${signal}`
    this.finish(this.exitError(`Codex app-server exited unexpectedly (${status})`))
  }

  private consumeChunk(chunk: Buffer): void {
    let offset = 0
    while (offset < chunk.byteLength && !this.closed && !this.closing) {
      const newline = chunk.indexOf(0x0a, offset)
      const end = newline < 0 ? chunk.byteLength : newline
      const segment = chunk.subarray(offset, end)
      if (this.lineBuffer.byteLength + segment.byteLength > this.maxLineBytes) {
        this.failProtocol('Inbound app-server message exceeds maxLineBytes')
        return
      }
      if (segment.byteLength > 0) {
        this.lineBuffer = Buffer.concat([this.lineBuffer, segment])
      }
      if (newline < 0) return
      this.emitLine(this.lineBuffer)
      this.lineBuffer = Buffer.alloc(0)
      offset = newline + 1
    }
  }

  private emitLine(bytes: Buffer): void {
    let lineBytes = bytes
    if (lineBytes.at(-1) === 0x0d) lineBytes = lineBytes.subarray(0, -1)
    if (lineBytes.byteLength === 0) {
      this.failProtocol('Codex app-server emitted an empty JSONL line')
      return
    }
    let line: string
    try {
      line = this.decoder.decode(lineBytes)
      const parsed: unknown = JSON.parse(line)
      if (!isObject(parsed)) throw new Error('message is not an object')
    } catch {
      this.failProtocol('Codex app-server emitted a malformed JSONL message')
      return
    }
    try {
      this.handlers?.onLine(line)
    } catch (error) {
      this.failProtocol(`App-server line handler failed: ${safeErrorMessage(error)}`)
    }
  }

  private failProtocol(message: string): void {
    this.failProcess(new Error(redactSensitive(message)))
  }

  private failProcess(error: Error): void {
    if (this.closed || this.closing) return
    this.closing = true
    this.closeError = error
    if (!this.stdinEnded) {
      this.stdinEnded = true
      this.child?.stdin.end()
    }
    this.child?.kill('SIGTERM')
    this.closePromise = this.terminate(true)
    this.notifyClose(error)
  }

  private exitError(message: string): Error {
    const stderr = redactSensitive(this.stderrBuffer.toString('utf8').trim())
    return new Error(stderr.length === 0 ? message : `${message}: ${stderr}`)
  }

  private finish(error?: Error): void {
    if (this.closed) return
    this.closed = true
    const child = this.child
    child?.stdout.off('data', this.onStdout)
    child?.stderr.off('data', this.onStderr)
    child?.off('error', this.onProcessError)
    child?.off('exit', this.onProcessExit)
    this.lineBuffer = Buffer.alloc(0)
    this.stderrBuffer = Buffer.alloc(0)
    this.resolveExit?.()
    this.notifyClose(error ?? this.closeError)
  }

  private async terminate(termAlreadySent = false): Promise<void> {
    const child = this.child
    if (child === undefined) {
      this.finish(this.closeError)
      return
    }
    if (!this.stdinEnded) {
      this.stdinEnded = true
      child.stdin.end()
    }
    if (!termAlreadySent) child.kill('SIGTERM')
    if (!this.processExited && !(await this.waitForExit(this.shutdownTimeoutMs))) {
      child.kill('SIGKILL')
      if (!(await this.waitForExit(this.shutdownTimeoutMs))) {
        const error = new Error('Codex app-server did not exit after SIGKILL')
        if (this.closeError === undefined) this.closeError = error
        this.notifyClose(error)
      }
    }
    this.finish(this.closeError)
  }

  private async waitForExit(timeoutMs: number): Promise<boolean> {
    if (this.processExited) return true
    const exitPromise = this.exitPromise
    if (exitPromise === undefined) return true
    return await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs)
      timer.unref()
      void exitPromise.then(() => {
        clearTimeout(timer)
        resolve(true)
      })
    })
  }

  private notifyClose(error?: Error): void {
    if (this.closeNotified) return
    this.closeNotified = true
    const handlers = this.handlers
    this.handlers = undefined
    handlers?.onClose(error)
  }
}

function positiveInteger(value: number, name: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(`${name} must be a safe integer of at least ${minimum}`)
  }
  return value
}

const spawnProcess: SpawnFactory = (command, args, options) => spawn(
  command,
  args,
  {
    ...options,
    stdio: ['pipe', 'pipe', 'pipe'],
  },
)
