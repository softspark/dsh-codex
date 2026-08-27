# dsh-codex

[![CI](https://github.com/softspark/dsh-codex/actions/workflows/ci.yml/badge.svg)](https://github.com/softspark/dsh-codex/actions/workflows/ci.yml)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)
[![DSH community plugin](https://img.shields.io/badge/DSH-community%20plugin-4b8bbe.svg)](https://github.com/topics/dsh-plugin)

`@softspark/dsh-codex` connects DeepSeek Harness to a locally authenticated Codex app server. Provider ID `codex` is implemented and verified from a local tarball.

The package remains pre-release and unpublished. Install it from source only. The plugin does not implement OAuth, read Codex authentication files, copy tokens, call the OpenAI Responses API directly, or emit telemetry.

This is an independently maintained SoftSpark community integration. It is unofficial and is not affiliated with or endorsed by OpenAI or DeepSeek.

## Verified status

The 2026-08-26 verification run produced this evidence:

- 131 of 131 unit, protocol, bridge, and composition tests passed.
- Coverage reached 88.98 percent statements, 82 percent branches, and 91.32 percent lines.
- A live app-server reported authentication kind `chatgpt` and seven models.
- A direct adapter turn returned the exact marker, finish reason `stop`, and token usage.
- An isolated DSH web profile booted with HTTP 200.
- DSH loaded provider `codex` with seven models.
- A DSH session survived a host restart with the same Codex thread ID, and a live cancellation ended as `aborted`.
- The user screenshot showed GPT-5.6-Sol with `xhigh` reasoning.

These results verify the source build and local tarball path. They do not represent an npm release.

## Requirements

- Node.js 22.19.0 or newer.
- npm for this repository.
- `pnpm` available to the DSH profile plugin manager.
- A local Codex CLI that can start `codex app-server`.
- An existing Codex login managed by the Codex CLI.
- DeepSeek Harness compatible with `@deepseek-ai/dsh-llm@0.1.1-rc.2` and `@deepseek-ai/cordis@4.0.1`.

For subscription-backed use, `codex login status` must report ChatGPT.

## Build and install a local tarball

```bash
git clone https://github.com/softspark/dsh-codex.git
cd dsh-codex

npm ci --ignore-scripts
npm run verify
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run audit
npm run package:check

command -v pnpm
pnpm --version

PLUGIN_TGZ="$(npm pack --ignore-scripts --silent)"
dsh plugin --profile web add "file:$(pwd)/$PLUGIN_TGZ"
```

Use an isolated `DSH_HOME` for evaluation before modifying a regular profile.

With DSH profiles configured as `autoInstallPeers=false`, a pnpm peer check can report missing `@deepseek-ai/cordis` and `@deepseek-ai/dsh-llm`. The verified DSH host loader supplies those extension seams. Do not install duplicate peer copies unless a future DSH version fails at runtime and its compatibility instructions require them.

The package is not available through `npm install @softspark/dsh-codex`.

## Install a published release

After the first public npm release, install the exact reviewed version into a DSH profile:

```bash
dsh plugin --profile web add @softspark/dsh-codex@0.2.0 --save-exact
```

Restart DSH after installation. Do not install an unpinned prerelease in production profiles.

## Architecture

```text
DeepSeek Harness
    |
    | provider: codex
    v
@softspark/dsh-codex
    |
    | validated JSON-RPC over JSONL stdio
    v
local codex app-server
    |
    | Codex-owned auth, agent loop, built-in tools, thread state
    v
ChatGPT subscription
```

The plugin maps DSH text messages, model choice, reasoning effort, streaming, usage, cancellation, and finish state to the stable app-server protocol. Codex owns authentication and credential storage.

## Configuration

| Field | Default | Notes |
|---|---|---|
| `provider` | `codex` | The only accepted provider route. |
| `command` | `codex` | Direct executable name or path. Empty values fail. |
| `cwd` | `process.cwd()` | Working directory for Codex threads. |
| `sandbox` | `workspace-write` | Also accepts `read-only` and `danger-full-access`. |
| `approvalPolicy` | `untrusted` | Also accepts `never` and `on-request`. |
| `allowApiKeyAuth` | `false` | When true, permits an API-key login already owned by Codex. The plugin never receives the key. |
| `experimentalDynamicTools` | `false` | Opts into the experimental DSH tool bridge and app-server experimental API. |
| `dynamicToolTimeoutMs` | `600000` | Bounds a deferred DSH tool call from 1,000 to 3,600,000 ms. |
| `requestTimeoutMs` | `30000` | Range 1,000 to 300,000 ms. |
| `turnTimeoutMs` | `600000` | Range 1,000 to 3,600,000 ms. |

See [configuration reference](kb/reference/configuration.md).

## Tool boundary

Codex app-server built-in tools run inside Codex under the selected Codex sandbox and approval policy.

By default, DSH tools remain unavailable and tool-result continuation fails closed. With `experimentalDynamicTools: true`, the adapter registers the current DSH tool catalog with Codex, emits canonical DSH tool-call chunks, lets the normal DSH agent loop execute the tool, then returns the correlated text result to the same Codex turn. The bridge never executes DSH tools directly.

The opt-in bridge is text-only, bounded, unavailable for ephemeral sessions, and does not support thread replay after a process restart. Use the sibling `@softspark/dsh-orchestrator` bundle to register subscription-backed Claude Code and Gemini ACP delegation tools.

## Security boundaries

- App-server starts as a direct child process with `shell: false`.
- JSON-RPC input is untrusted and runtime validated.
- Credential-like values are redacted from errors and diagnostics.
- The plugin adds no telemetry, remote logging, or direct network client.
- DSH and Cordis remain peer dependencies supplied by the host.
- npm lifecycle scripts are forbidden.

Report vulnerabilities privately through [SECURITY.md](SECURITY.md).

## Development

```bash
npm ci --ignore-scripts
npm run verify
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run audit
npm run audit:permissions
npm run audit:dependencies
npm run audit:signatures
npm run package:check
```

## Documentation

| Document | Purpose |
|---|---|
| [Architecture](kb/reference/architecture.md) | Runtime layers and trust boundaries |
| [Configuration](kb/reference/configuration.md) | Provider schema and defaults |
| [Setup](kb/howto/setup.md) | Source build and local tarball installation |
| [Implementation plan](kb/planning/dsh-codex-implementation-plan.md) | Verified phases and remaining release work |
| [CHANGELOG.md](CHANGELOG.md) | Unreleased changes |
| [SECURITY.md](SECURITY.md) | Reporting and security scope |

## License

Apache-2.0. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
