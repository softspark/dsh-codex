import type {
  AppServerTransport,
  TransportHandlers,
} from '../../src/app-server/transport.js'

export class FakeTransport implements AppServerTransport {
  readonly sentLines: string[] = []
  started = false
  closed = false
  private handlers?: TransportHandlers

  async start(handlers: TransportHandlers): Promise<void> {
    this.started = true
    this.handlers = handlers
  }

  async send(line: string): Promise<void> {
    if (!this.started || this.closed) {
      throw new Error('transport is not open')
    }
    this.sentLines.push(line)
  }

  async close(): Promise<void> {
    this.closed = true
  }

  emitLine(line: string): void {
    this.requireHandlers().onLine(line)
  }

  emitMessage(message: unknown): void {
    this.emitLine(JSON.stringify(message))
  }

  emitClose(error?: Error): void {
    this.requireHandlers().onClose(error)
  }

  messages(): unknown[] {
    return this.sentLines.map((line) => JSON.parse(line) as unknown)
  }

  messageAt(index: number): Record<string, unknown> {
    const message = this.messages()[index]
    if (message === null || typeof message !== 'object' || Array.isArray(message)) {
      throw new TypeError(`message ${index} is not an object`)
    }
    return message as Record<string, unknown>
  }

  private requireHandlers(): TransportHandlers {
    if (!this.handlers) throw new Error('transport has not been started')
    return this.handlers
  }
}
