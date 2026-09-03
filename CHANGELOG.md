# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-09-03

### Added

- Optional `inheritSessionPermissions` mapping for newly started or resumed Codex threads. It consumes explicit per-session DSH sandbox overrides and maps only deterministic DSH `never` approval to Codex `never`; missing and interactive state retains the static fail-closed fallback.

## [1.3.0] - 2026-09-03

### Added

- `onRejectedToolCall`, called with the failure class whenever a dynamic tool
  call is refused. Every one of the nine refusals in `handleServerRequest`
  routes through it.

  Codex renders each of them as its own `dynamic tool request failed`, with no
  reason attached, so a lost turn, a pending-call limit, an unknown tool and a
  duplicate id are indistinguishable from outside. A real session refused all
  seven of its tool calls over two and a half minutes and could not be told
  apart from one that had timed out; the reason existed the whole time and had
  nowhere to go. The plugin wires this to `ctx.logger`, so `make logs` carries
  it whatever Codex chooses to display.

### Changed

- `safeErrorMessage` prefixes the stable failure class when the error carries
  one, so the string that reaches the app-server names the class too.

## [1.2.2] - 2026-09-03

### Fixed

- A background subagent finishing while dynamic tool calls were outstanding
  failed the whole turn with `DYNAMIC_TOOL_UNEXPECTED_INPUT`. The guard
  rejected on `role: 'user'`, and DSH gives injected context that role too —
  it records the producer in `source.kind`, which is `plugin` for a `tool-jobs`
  notice. So the orchestrator's own workflow, start subagents and collect them
  as they land, ended the turn.

  The guard now tests `source.kind === 'user'`: a person's typed question is
  still refused, because the app-server is waiting for tool results and there
  is nowhere to put a new question until they arrive. `selectUserMessages` had
  the same shape and the same mistake.

  Two tests cover both directions — a plugin notice is accepted, a typed
  question is still refused.

## [1.2.1] - 2026-09-03

### Fixed

- Image input failed the turn outright with `cannot get property "attachments"
  without inject`. 1.1.0 read `ctx.attachments` directly; cordis refuses a
  property the plugin never declared, so the first message carrying an image
  ended the turn — a worse failure than the one image support replaced.

  The store is requested through `ctx.inject(['attachments'], …)`, the optional
  form. Naming it in the plugin's own `inject` array would have been the wrong
  cure: that array is a hard requirement, so a deployment mounting no
  attachment store would stop loading this provider entirely rather than lose
  image input. A missing store still degrades to a clear per-request error.

  The two composition tests that hand-build a context stub now provide
  `inject` and assert it was called with `['attachments']` — the declaration
  itself is the thing that was missing.

## [1.2.0] - 2026-09-02

### Changed

- The `@deepseek-ai/cordis` peer moves from `4.0.1` to `4.0.2`. This corrects a
  mismatch rather than following a release: `@deepseek-ai/dsh` 0.1.1-rc.2 ships
  cordis 4.0.2, so the exact `4.0.1` peer was already wrong against the runtime
  this plugin is composed into.
- Development dependencies: `@deepseek-ai/cordis-plugin-include` 1.0.7,
  `@deepseek-ai/cordis-plugin-loader` 1.0.3, `@types/node` 26.4.0. The two
  cordis plugins require `cordis ^4.0.2`, which is what surfaced the peer drift.

`typescript` stays at 5.9.3. Dependabot grouped a bump to 7.0.2 with the rest,
which `typescript-eslint@8.68.0` does not accept — the tree does not resolve.
That upgrade waits for a typescript-eslint release that supports it.

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
