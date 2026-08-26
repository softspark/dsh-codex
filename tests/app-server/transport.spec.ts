import { EventEmitter } from 'node:events'
import type { ChildProcessWithoutNullStreams, SpawnOptions } from 'node:child_process'

import { afterEach, describe, expect, it, vi } from 'vitest'

import { ChildProcessTransport } from '../../src/app-server/transport.js'

interface FakeChildOptions {
  readonly backpressure?: boolean
}

function createFakeChild(options: FakeChildOptions = {}) {
  const processEvents = new EventEmitter()
  const stdout = new EventEmitter()
  const stderr = new EventEmitter()
  const stdin = new EventEmitter() as EventEmitter & {
    end: ReturnType<typeof vi.fn>
    write: ReturnType<typeof vi.fn>
  }
  stdin.end = vi.fn()
  stdin.write = vi.fn((line: string, encoding: string, callback: (error?: Error) => void) => {
    expect(encoding).toBe('utf8')
    queueMicrotask(() => callback())
    return options.backpressure !== true
  })
  const kill = vi.fn(() => true)
  const child = Object.assign(processEvents, { stdout, stderr, stdin, kill })
  return {
    child: child as unknown as ChildProcessWithoutNullStreams,
    stdout,
    stderr,
    stdin,
    kill,
    exit(code: number | null = 0, signal: NodeJS.Signals | null = null) {
      processEvents.emit('exit', code, signal)
    },
  }
}

function createHarness(options: FakeChildOptions & {
  readonly maxLineBytes?: number
  readonly maxStderrBytes?: number
  readonly shutdownTimeoutMs?: number
} = {}) {
  const child = createFakeChild(options)
  const spawnFactory = vi.fn((_command: string, _args: string[], _spawn: SpawnOptions) => child.child)
  const onLine = vi.fn()
  const onClose = vi.fn()
  const transport = new ChildProcessTransport({
    command: '/opt/bin/codex',
    cwd: '/workspace',
    env: { PATH: '/opt/bin', CODEX_HOME: '/safe/home' },
    maxLineBytes: options.maxLineBytes ?? 1_024,
    maxStderrBytes: options.maxStderrBytes ?? 128,
    shutdownTimeoutMs: options.shutdownTimeoutMs ?? 20,
    spawnFactory,
  })
  return { child, spawnFactory, onLine, onClose, transport }
}

describe('ChildProcessTransport', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('spawns only codex app-server stdio with shell disabled', async () => {
    const harness = createHarness()

    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    expect(harness.spawnFactory).toHaveBeenCalledWith(
      '/opt/bin/codex',
      ['app-server', '--listen', 'stdio://'],
      {
        cwd: '/workspace',
        env: { PATH: '/opt/bin', CODEX_HOME: '/safe/home' },
        shell: false,
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
      },
    )
  })

  it('frames split and coalesced JSONL messages in order', async () => {
    const harness = createHarness()
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    harness.child.stdout.emit('data', Buffer.from('{"id":1,"res'))
    harness.child.stdout.emit('data', Buffer.from('ult":{}}\n{"method":"one"}\n{"method":"two"}\n'))

    expect(harness.onLine.mock.calls.map(([line]) => line)).toEqual([
      '{"id":1,"result":{}}',
      '{"method":"one"}',
      '{"method":"two"}',
    ])
  })

  it.each([
    ['malformed JSON', Buffer.from('{bad}\n')],
    ['invalid UTF-8', Buffer.from([0xc3, 0x28, 0x0a])],
    ['empty line', Buffer.from('\n')],
  ])('fails closed for %s', async (_label, bytes) => {
    const harness = createHarness()
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    harness.child.stdout.emit('data', bytes)

    expect(harness.onClose).toHaveBeenCalledOnce()
    expect(harness.child.kill).toHaveBeenCalledWith('SIGTERM')
    expect(harness.onLine).not.toHaveBeenCalled()
  })

  it('fails closed when an inbound line exceeds its byte limit', async () => {
    const harness = createHarness({ maxLineBytes: 1_024 })
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    harness.child.stdout.emit('data', Buffer.alloc(1_025, 0x78))

    expect(harness.onClose.mock.calls[0]?.[0]).toMatchObject({
      message: 'Inbound app-server message exceeds maxLineBytes',
    })
    expect(harness.child.kill).toHaveBeenCalledWith('SIGTERM')
  })

  it('rejects newline injection and oversized outbound messages', async () => {
    const harness = createHarness({ maxLineBytes: 1_024 })
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    await expect(harness.transport.send('{"ok":true}\n{"evil":true}')).rejects.toThrow(
      /exactly one JSONL line/u,
    )
    await expect(harness.transport.send('x'.repeat(1_025))).rejects.toThrow(
      /exceeds maxLineBytes/u,
    )
    expect(harness.child.stdin.write).not.toHaveBeenCalled()
  })

  it('waits for drain after backpressure before resolving send', async () => {
    const harness = createHarness({ backpressure: true })
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })
    let settled = false

    const sending = harness.transport.send('{"id":1}').then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    harness.child.stdin.emit('drain')
    await sending

    expect(settled).toBe(true)
    expect(harness.child.stdin.write).toHaveBeenCalledWith(
      '{"id":1}\n',
      'utf8',
      expect.any(Function),
    )
  })

  it('bounds and redacts stderr on unexpected exit', async () => {
    const harness = createHarness({ maxStderrBytes: 128 })
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })
    harness.child.stderr.emit('data', Buffer.from('x'.repeat(200)))
    harness.child.stderr.emit('data', Buffer.from(' Bearer raw-secret-token'))

    harness.child.exit(23)

    const failure = harness.onClose.mock.calls[0]?.[0] as Error
    expect(failure.message).not.toContain('raw-secret-token')
    expect(failure.message).toContain('Bearer [REDACTED]')
    expect(failure.message.length).toBeLessThan(220)
    expect(failure.message).toContain('code 23')
  })

  it('escalates a protocol-failed child that ignores TERM and releases all listeners', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ shutdownTimeoutMs: 20 })
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    harness.child.stdout.emit('data', Buffer.from('{malformed}\n'))
    const closing = harness.transport.close()

    expect(harness.child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(20)
    expect(harness.child.kill).toHaveBeenCalledWith('SIGKILL')
    harness.child.exit(null, 'SIGKILL')

    await expect(closing).resolves.toBeUndefined()
    expect(harness.onClose).toHaveBeenCalledOnce()
    expect(harness.child.stdout.listenerCount('data')).toBe(0)
    expect(harness.child.stderr.listenerCount('data')).toBe(0)
    expect(harness.child.child.listenerCount('error')).toBe(0)
    expect(harness.child.child.listenerCount('exit')).toBe(0)
    expect(harness.child.kill).toHaveBeenCalledTimes(2)
  })

  it('reports process errors and unexpected signals', async () => {
    const harness = createHarness()
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    harness.child.child.emit('error', new Error('Bearer raw-secret-token'))

    expect(harness.onClose.mock.calls[0]?.[0]).toMatchObject({
      message: 'Codex app-server process error',
    })
  })

  it('performs idempotent TERM then KILL cleanup', async () => {
    vi.useFakeTimers()
    const harness = createHarness({ shutdownTimeoutMs: 20 })
    await harness.transport.start({ onLine: harness.onLine, onClose: harness.onClose })

    const first = harness.transport.close()
    const second = harness.transport.close()
    expect(second).toBe(first)
    expect(harness.child.kill).toHaveBeenCalledWith('SIGTERM')
    await vi.advanceTimersByTimeAsync(20)
    expect(harness.child.kill).toHaveBeenCalledWith('SIGKILL')
    harness.child.exit(null, 'SIGKILL')

    await expect(first).resolves.toBeUndefined()
    expect(harness.child.stdin.end).toHaveBeenCalledOnce()
    expect(harness.child.kill).toHaveBeenCalledTimes(2)
  })
})
