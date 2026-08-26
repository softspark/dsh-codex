# Changelog

All notable changes to this project are documented in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). This project uses [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.2.0] - Unreleased

### Added

- Opt-in app-server `dynamicTools` bridge through the standard DSH tool-result loop.
- Deferred same-turn continuation, atomic multi-result correlation, catalog snapshot caching, and explicit tool/schema/result bounds.
- Integration coverage for real `LlmRuntime.prepareCall()`, parallel sessions, abort cleanup, restart failure, and UTF-8 identifier limits.

### Security

- Stable mode remains the default and rejects DSH tool-result continuation.
- Dynamic results are text-only, validated atomically, size-bounded, and never executed directly by the adapter.

### Verified

- 131 of 131 tests pass.
- Coverage is 88.98 percent statements, 82 percent branches, and 91.32 percent lines.

## [0.1.0] - Unreleased

### Added

- Initial `@softspark/dsh-codex` package scaffold and Cordis bundle patch.
- Stable app-server JSONL transport, runtime validation, bounded lifecycle, and credential redaction.
- DSH provider `codex` with ChatGPT auth enforcement, seven-model discovery, text and reasoning streaming, token usage, stop state, cancellation, and replay state.
- Strict configuration schema for executable, working directory, sandbox, approvals, auth mode, timeouts, and the disabled experimental-tool gate.
- Apache-2.0 licensing, multi-OS CI, SARIF auditing, npm provenance controls, and repository KB.

### Verified

- 92 of 92 unit and composition tests pass.
- Coverage is 88.35 percent statements and 91.33 percent lines.
- Live app-server smoke reports `authKind=chatgpt` and seven models.
- Direct adapter smoke returns the exact marker, finish reason `stop`, and usage.
- Isolated DSH web boot returns HTTP 200.
- DSH loads provider `codex` with seven models, resumes the same Codex thread after a host restart, and aborts a live turn.
- User screenshot confirms GPT-5.6-Sol at `xhigh` reasoning.

### Security

- Codex retains sole ownership of credentials and token refresh.
- npm lifecycle scripts remain disabled.
- DSH tool definitions and tool-result continuation fail closed in stable mode.

The package remains unpublished.
