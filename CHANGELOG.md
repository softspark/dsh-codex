# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.1] - 2026-09-02

### Changed

- `MAX_DYNAMIC_TOOL_RESULT_BYTES` raised from 1 MiB to 4 MiB. The cap is an
  aggregate over one result batch, not per result, and up to
  `MAX_PENDING_DYNAMIC_TOOL_CALLS` parallel calls share it — sixteen concurrent
  delegations had 64 KiB each. A breach still rejects the whole batch and fails
  the turn, because the batch is validated atomically; the limit moved rather
  than the atomicity.

### Fixed

- The app-server client test repeated `clientInfo.version` as a literal, so the
  1.1.0 bump failed the entire app-server suite. It reads `package.json` now,
  which `verify:version` already pins `DEFAULT_CLIENT_INFO` to. Tag `v1.1.0`
  carries that failure; nothing was published to npm from it.

## [1.1.0] - 2026-09-02

### Fixed

- A lost dynamic-tool turn no longer costs the whole session. An aborted turn — a
  timeout, an interrupt, a restarted adapter — leaves its tool results in the
  transcript permanently, and every later request was refused because of them,
  so one overrun turn ended the conversation for good. Tool results are now
  fatal only when the request carries nothing else to act on; when the user has
  said something new, the dead calls are dropped and a fresh turn starts.
- Dynamic-tool threads are resumed instead of refused. `thread/resume` accepts
  `dynamicTools` — verified against the app-server — so the blanket
  `DYNAMIC_TOOL_REPLAY_UNSUPPORTED` refusal enforced a limit the protocol does
  not impose.

### Added

- Image input. The app-server's user input has always carried an `image`
  variant, but every non-text content block was rejected before it could be
  sent, and the adapter separately reported every model as text-only. Model
  modalities are now taken from what the app-server reports, and image bytes are
  read through `ctx.attachments` — never from a path a message names — and sent
  as a data URL.
- `@deepseek-ai/dsh-attachment` as a peer dependency.

## [1.0.0] - 2026-08-27

### Added

- Opt-in app-server `dynamicTools` bridge through the standard DSH tool-result loop.
- Deferred same-turn continuation, atomic multi-result correlation, catalog snapshot caching, and explicit tool/schema/result bounds.
- Integration coverage for real `LlmRuntime.prepareCall()`, parallel sessions, abort cleanup, restart failure, and UTF-8 identifier limits.
- Public community-plugin badge, DSH discovery metadata, and the pinned npm installation command for the forthcoming release.
- Initial `@softspark/dsh-codex` package scaffold and Cordis bundle patch.
- Stable app-server JSONL transport, runtime validation, bounded lifecycle, and credential redaction.
- DSH provider `codex` with ChatGPT auth enforcement, seven-model discovery, text and reasoning streaming, token usage, stop state, cancellation, and replay state.
- Strict configuration schema for executable, working directory, sandbox, approvals, auth mode, timeouts, and the disabled experimental-tool gate.
- Apache-2.0 licensing, multi-OS CI, SARIF auditing, npm provenance controls, and repository KB.

### Security

- Stable mode remains the default and rejects DSH tool-result continuation.
- Dynamic results are text-only, validated atomically, size-bounded, and never executed directly by the adapter.
- Codex retains sole ownership of credentials and token refresh.
- npm lifecycle scripts remain disabled.

### Fixed

- CI and publish workflows now write raw SARIF JSON without npm lifecycle output prefixes.
- SARIF artifact upload uses the Node.js 24 based `actions/upload-artifact@v7` runtime.

### Verified

- 131 of 131 tests pass.
- Coverage is 88.98 percent statements, 82 percent branches, and 91.32 percent lines.
- Live app-server smoke reports `authKind=chatgpt` and seven models.
- Direct adapter smoke returns the exact marker, finish reason `stop`, and usage.
- Isolated DSH web boot returns HTTP 200.
- DSH loads provider `codex` with seven models, resumes the same Codex thread after a host restart, and aborts a live turn.
- User screenshot confirms GPT-5.6-Sol at `xhigh` reasoning.
