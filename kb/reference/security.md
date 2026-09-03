---
title: "dsh-codex Security Model"
category: reference
service: dsh-codex
tags: [security, credentials, subprocess, json-rpc, tools]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Defines credential ownership, environment minimization, replay validation, process termination, and tool boundaries."
---

# dsh-codex Security Model

## Security objective

Expose a local Codex agent to DSH without creating a second OpenAI credential holder.

OpenAI states that Codex caches login details in `CODEX_HOME` or the OS credential store and refreshes ChatGPT tokens during use. Those locations belong to Codex. See [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth).

## Invariants

1. The plugin never reads, writes, copies, parses, backs up, or logs Codex credential storage.
2. The plugin never implements OAuth or accepts an OpenAI API key.
3. The plugin never calls OpenAI HTTP APIs directly.
4. The app server starts without a shell.
5. Every JSONL message is untrusted until runtime validation succeeds.
6. Credential-like error data is redacted before exposure.
7. Experimental tools are disabled by default and absent from the 0.1 provider.
8. The Codex child receives only the explicit cross-platform environment allowlist.
9. Replay resumes only from valid state owned by the same provider.

## Threat boundaries

| Boundary | Threat | Control |
|---|---|---|
| Executable launch | PATH substitution, shell injection, or ambient secret inheritance. | Direct spawn with a fixed argument vector, `shell: false`, and a minimal environment allowlist. GitHub, AWS, npm, Anthropic, OpenAI, and arbitrary project secrets are dropped even when `allowApiKeyAuth` is true. |
| Child stdout | Malformed JSON, invalid UTF-8, oversized output, protocol desynchronization. | Fatal UTF-8 decoding, JSON-object validation, 8 MiB line limit, and fail-closed connection shutdown. |
| Child stderr | Secrets or unbounded diagnostics. | Retain at most 64 KiB and redact before error exposure. Never log the environment. |
| JSON-RPC requests | Hanging process, orphaned work, or failed double replies. | 30 second outgoing-request timeout; separate bounded dynamic-handler timeout; abort signals, pending rejection, and terminal closure after failed double replies. |
| Process failure | Malformed protocol leaves a child alive. | Close stdin, send TERM, wait 5 seconds, then send KILL and release listeners. |
| Replay | Foreign, stale, or malformed thread state crosses sessions. | Accept version 1 replay only from the newest same-provider assistant; require non-empty thread and turn IDs; never fall back to an older replay. |
| Account data | Accidental token exposure. | Parse only account type and auth booleans. Ignore raw credential data. |
| Model and stream data | Schema drift or unsupported variants. | Runtime guards and pinned-Codex compatibility tests. |
| DSH approvals and sandbox | Privilege mismatch between two agent systems. | Do not weaken either system. Map only tested stable policies. |
| Dynamic tools | Codex-triggered DSH tool execution with excess authority. | Disabled by default; opt-in catalogs and results are bounded and validated, while DSH performs execution through its normal permission path. |

[PATH: src/app-server/transport.ts] [PATH: src/app-server/validation.ts] [PATH: src/app-server/redaction.ts]

## Data handling

Prompts, model output, file paths, and tool results can contain confidential data. The plugin keeps them in the local process pipe and DSH session surfaces already selected by the user. It adds no persistence, telemetry, analytics, crash reporting, or remote logging.

The child environment carries only runtime prerequisites such as PATH, home paths, proxy and CA settings, locale, terminal, WSL, XDG, and Windows platform variables. It does not inherit ambient tool or cloud credentials.

Tests use synthetic credentials. Secret scanners must distinguish explicit fixtures from real secrets without weakening structural detection for private keys or real token formats.

## Replay boundary

Stable same-provider replay resumes a recorded Codex thread and advances a bounded last-user cursor. The newest same-provider assistant is authoritative. Dynamic-tool threads never resume after process restart because tool catalogs and server requests are process-local; they fail with `DYNAMIC_TOOL_REPLAY_UNSUPPORTED` and require a new session.

## Sandbox and approvals

Codex and DSH each have a permission model. The adapter must not translate a permissive value by default or silently treat one system's approval as authorization in the other.

Stable mode relies on Codex's own sandbox and approvals. In opt-in dynamic mode, DSH retains its own sandbox, permission, audit, and tool-result persistence controls; the adapter cannot bypass them by executing a tool directly.

Session permission inheritance is separately opt-in. For a newly started or resumed thread, the adapter may copy a validated sandbox override from that exact DSH Session and map the deterministic DSH `never` approval policy to Codex `never`. It never converts interactive DSH `ask` into authorization, and missing or malformed session state retains the configured static fallback.

## Supply chain

The package uses exact dependency versions and a lockfile. npm lifecycle scripts are disabled. CI runs high-severity dependency audit, signature verification, SARIF generation, multi-OS tests, and package inspection. Tagged publication uses npm provenance.

See the SoftSpark module SOP: [PATH: shared/rag-mcp/procedures/softspark-module-template.md].

## Security verification

Run:

```bash
npm ci --ignore-scripts
npm run audit
npm run audit:permissions
npm run audit:dependencies
npm run audit:signatures
npm run test:coverage
npm run package:check
```

A release is blocked by any unresolved high or critical dependency finding, lifecycle script, unexpected permission surface, credential leak, protocol validation regression, or provenance failure.
