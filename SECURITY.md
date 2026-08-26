# Security Policy

## Supported versions

`@softspark/dsh-codex` has not been published. Version `0.2.0` is under development and receives security fixes on `main`.

## Reporting a vulnerability

Email **biuro@softspark.eu**. Do not open a public issue.

Include the affected commit, reproduction steps, impact, and a minimal proof of concept. Remove tokens, authorization headers, Codex state, prompts, workspace contents, and personal data before sending the report.

SoftSpark will acknowledge a report within 48 hours. We will coordinate validation, remediation, disclosure timing, and credit with the reporter.

## Security design

### Credentials

Codex owns login, token refresh, credential storage, and account state. The plugin must not read or write Codex authentication files. It must not accept raw access tokens, refresh tokens, cookies, API keys, or authorization headers as configuration.

Diagnostics must redact credential-like fields and bearer values. Tests use synthetic placeholders only.

### Process boundary

The plugin starts the local `codex app-server` executable directly and communicates over stdio. It never invokes a shell or interpolates arguments into command strings.

The child receives an explicit cross-platform allowlist only: executable paths, user and Codex homes, temporary and XDG directories, proxy settings, CA paths, locale, terminal, WSL, and Windows platform variables. Ambient project and cloud credentials such as GitHub, AWS, npm, Anthropic, and OpenAI keys are dropped. `allowApiKeyAuth: true` does not widen this environment; it permits only API-key credentials already owned by Codex.

The executable path and arguments are untrusted configuration. Implementations must validate them before process creation. Child processes require startup, request, and shutdown timeouts plus cancellation.

### JSON-RPC boundary

Every app-server response, notification, and server request is untrusted. Runtime validation must reject malformed IDs, unknown shapes, invalid tool payloads, and unsafe error data.

Parsers must bound line size, pending requests, buffered output, and tool-result size. Protocol failures close stdin, send TERM, and escalate to KILL after the bounded shutdown timeout. Incoming server-request handlers use the request timeout and receive an abort signal. A result plus error-reply double failure rejects pending work and closes the client without an unhandled rejection.

In stable mode, valid same-provider replay state may resume a Codex thread after plugin restart. The adapter validates the newest same-provider assistant state and never falls back to an older thread. Dynamic-tool threads are process-local and never resume after restart, even when no call was pending; their replay fails closed with `DYNAMIC_TOOL_REPLAY_UNSUPPORTED`.

### Tool boundary

Experimental dynamic tools are disabled by default. When explicitly enabled, catalog names, descriptions, schemas, arguments, call IDs, pending counts, per-turn counts, result batches, and timeouts are bounded. Results are validated as one atomic text-only batch before any app-server response. DSH remains the sole tool executor under its normal agent, sandbox, approval, logging, and persistence path.

A dynamic-tool thread cannot be restored after process loss. Restart-time continuation fails closed instead of attaching tools or results to an older or different Codex turn. Aborts, handler timeouts, invalid batches, and adapter close reject every pending call and interrupt the Codex turn exactly once.

### Network and telemetry

The plugin must not add a direct HTTP client, telemetry, analytics, crash upload, or remote logging. Network traffic initiated by Codex or DSH remains under those products' configuration and policy.

## Scope

Reports about this adapter, its packaging, process handling, protocol validation, tool bridge, or redaction are in scope.

Vulnerabilities in Codex, OpenAI services, DeepSeek Harness, Cordis, Node.js, or third-party packages should also be reported to the affected upstream project. Dependency reports that demonstrate an exploitable path through this package remain in scope.
