import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

import { Context } from '@deepseek-ai/cordis'
import LlmRuntime from '@deepseek-ai/dsh-llm'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { CodexAdapter } from '../src/adapter.js'
import { AppServerClient } from '../src/app-server/client.js'
import {
  apply,
  childEnvironment,
  name,
  resolveConfig,
} from '../src/index.js'
import * as DshCodexPlugin from '../src/index.js'

describe('plugin configuration', () => {
  it('resolves stable fail-closed defaults', () => {
    expect(resolveConfig()).toEqual({
      provider: 'codex',
      command: 'codex',
      cwd: process.cwd(),
      sandbox: 'workspace-write',
      approvalPolicy: 'untrusted',
      allowApiKeyAuth: false,
      experimentalDynamicTools: false,
      requestTimeoutMs: 30_000,
      turnTimeoutMs: 600_000,
      dynamicToolTimeoutMs: 600_000,
    })
  })

  it('enables the experimental dynamic-tool bridge only through explicit config', () => {
    expect(resolveConfig({
      cwd: '/workspace',
      experimentalDynamicTools: true,
      dynamicToolTimeoutMs: 90_000,
    } as Parameters<typeof resolveConfig>[0])).toMatchObject({
      experimentalDynamicTools: true,
      dynamicToolTimeoutMs: 90_000,
    })

    expect(resolveConfig({ cwd: '/workspace' })).toMatchObject({
      experimentalDynamicTools: false,
      dynamicToolTimeoutMs: 600_000,
    })
  })

  it('filters ambient API keys without mutating the source unless explicitly allowed', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/opt/bin',
      HOME: '/home/tester',
      CODEX_HOME: '/home/tester/.codex',
      HTTPS_PROXY: 'https://proxy.example.test',
      HTTP_PROXY: 'http://proxy.example.test',
      NO_PROXY: '127.0.0.1,localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/custom.pem',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
      WSL_INTEROP: '/run/WSL/123_interop',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT',
      GITHUB_TOKEN: 'github-token',
      AWS_SECRET_ACCESS_KEY: 'aws-secret',
      ARBITRARY_SECRET: 'arbitrary-secret',
      OPENAI_API_KEY: 'openai-key',
      AZURE_OPENAI_API_KEY: 'azure-key',
      CODEX_API_KEY: 'codex-key',
    }
    const snapshot = { ...source }
    const requiredEnvironment = {
      PATH: '/opt/bin',
      HOME: '/home/tester',
      CODEX_HOME: '/home/tester/.codex',
      HTTPS_PROXY: 'https://proxy.example.test',
      HTTP_PROXY: 'http://proxy.example.test',
      NO_PROXY: '127.0.0.1,localhost',
      NODE_EXTRA_CA_CERTS: '/etc/ssl/custom.pem',
      SSL_CERT_FILE: '/etc/ssl/cert.pem',
      LC_ALL: 'en_US.UTF-8',
      LANG: 'en_US.UTF-8',
      WSL_INTEROP: '/run/WSL/123_interop',
      CLICOLOR: '1',
      CLICOLOR_FORCE: '1',
      SystemRoot: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.COM;.EXE;.BAT',
    }

    expect(childEnvironment(false, source)).toEqual(requiredEnvironment)
    expect(source).toEqual(snapshot)
    expect(childEnvironment(true, source)).toEqual(requiredEnvironment)
    expect(source).toEqual(snapshot)
  })

  it.each([
    [{ command: '   ' }, /command must not be empty/u],
    [{ cwd: '   ' }, /cwd must not be empty/u],
    [{ requestTimeoutMs: 999 }, /requestTimeoutMs/u],
    [{ requestTimeoutMs: 300_001 }, /requestTimeoutMs/u],
    [{ requestTimeoutMs: 1_000.5 }, /requestTimeoutMs/u],
    [{ turnTimeoutMs: 999 }, /turnTimeoutMs/u],
    [{ turnTimeoutMs: 3_600_001 }, /turnTimeoutMs/u],
    [{ dynamicToolTimeoutMs: 999 }, /dynamicToolTimeoutMs/u],
    [{ dynamicToolTimeoutMs: 3_600_001 }, /dynamicToolTimeoutMs/u],
    [{ dynamicToolTimeoutMs: 1_000.5 }, /dynamicToolTimeoutMs/u],
  ] as const)('rejects invalid config %j', (config, expected) => {
    expect(() => resolveConfig(
      config as Parameters<typeof resolveConfig>[0],
    )).toThrow(expected)
  })

  it('owns adapter registration disposal and client close in one effect', async () => {
    const unregister = vi.fn()
    let cleanup: (() => Promise<void>) | undefined
    const registerAdapter = vi.fn(() => unregister)
    const close = vi.spyOn(AppServerClient.prototype, 'close').mockResolvedValue()
    const ctx = {
      llm: { registerAdapter },
      effect: vi.fn((execute: () => () => Promise<void>) => {
        cleanup = execute()
        return vi.fn()
      }),
    } as unknown as Context

    apply(ctx, { cwd: '/workspace' })

    expect(registerAdapter).toHaveBeenCalledWith(
      ['codex'],
      expect.any(CodexAdapter),
    )
    expect(cleanup).toBeDefined()
    await cleanup?.()
    expect(unregister).toHaveBeenCalledOnce()
    expect(close).toHaveBeenCalledOnce()
  })

  it('composes the opt-in bridge without changing provider ownership', async () => {
    const unregister = vi.fn()
    let cleanup: (() => Promise<void>) | undefined
    const ctx = {
      llm: { registerAdapter: vi.fn(() => unregister) },
      effect: vi.fn((execute: () => () => Promise<void>) => {
        cleanup = execute()
        return vi.fn()
      }),
    } as unknown as Context

    apply(ctx, {
      cwd: '/workspace',
      experimentalDynamicTools: true,
    })

    expect(ctx.llm.registerAdapter).toHaveBeenCalledWith(
      ['codex'],
      expect.any(CodexAdapter),
    )
    await cleanup?.()
    expect(unregister).toHaveBeenCalledOnce()
  })
})

describe('Cordis composition', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers and tears down the codex route with the real llm service', async () => {
    const ctx = new Context()
    const llmFiber = await ctx.plugin(LlmRuntime)
    const pluginFiber = await ctx.plugin(DshCodexPlugin, { cwd: '/workspace' })

    expect(ctx.llm.listProviders()).toContainEqual({
      id: 'codex',
      name: 'OpenAI Codex',
    })

    await pluginFiber.dispose()
    expect(ctx.llm.listProviders()).not.toContainEqual(expect.objectContaining({ id: 'codex' }))
    await llmFiber.dispose()
  })

  it('publishes a resolvable Cordis patch and package entry', async () => {
    const root = process.cwd()
    const patch = await readFile(join(root, 'cordis.patch.yml'), 'utf8')
    const packageJson = JSON.parse(
      await readFile(join(root, 'package.json'), 'utf8'),
    ) as {
      readonly name: string
      readonly dsh?: { readonly bundle?: { readonly patch?: string } }
      readonly peerDependencies?: Record<string, string>
    }

    expect(name).toBe('dsh-codex')
    expect(packageJson.name).toBe('@softspark/dsh-codex')
    expect(packageJson.dsh?.bundle?.patch).toBe('./cordis.patch.yml')
    expect(packageJson.peerDependencies).toMatchObject({
      // A literal on purpose, unlike clientInfo.version: this is the published
      // peer contract, so moving it must be a deliberate edit here too. 4.0.2
      // is what @deepseek-ai/dsh 0.1.1-rc.2 actually ships.
      '@deepseek-ai/cordis': '4.0.2',
      '@deepseek-ai/dsh-llm': '0.1.1-rc.2',
    })
    expect(patch).toContain("name: '@softspark/dsh-codex'")
  })
})
