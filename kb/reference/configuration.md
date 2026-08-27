---
title: "dsh-codex Configuration Reference"
category: reference
service: dsh-codex
tags: [configuration, dsh, codex, models, authentication]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Documents the implemented provider schema, environment allowlist, replay behavior, and tested defaults."
---

# dsh-codex Configuration Reference

## Publication status

The provider schema is implemented and composition tested for the documented text, reasoning, replay, cancellation, and opt-in dynamic-tool scope.

## Required external state

| Requirement | Check |
|---|---|
| Node.js 22.19 or newer | `node --version` |
| Codex CLI on the process PATH | `command -v codex && codex --version` |
| ChatGPT authentication for subscription use | `codex login status` |
| App-server command available | `codex app-server --help` |
| Compatible DSH profile | Confirm the target profile uses the tested DSH prerelease. |

OpenAI documents ChatGPT sign-in as the subscription-backed mode. API-key sign-in is usage-based and is not the target for this plugin. See [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth).

## Provider identity

The Cordis patch registers provider ID `codex`. Isolated DSH composition loaded the provider, exposed seven models, and completed an end-to-end prompt. The package remains source and local-tar only until publication.

## App-server controls

The implemented plugin fields are:

| Field | Default | Validation and behavior |
|---|---:|---|
| `provider` | `codex` | The only accepted route. |
| `command` | `codex` | Direct executable name or path; empty values fail. |
| `cwd` | `process.cwd()` | Working directory for Codex threads. |
| `sandbox` | `workspace-write` | Also accepts `read-only` and `danger-full-access`. |
| `approvalPolicy` | `untrusted` | Also accepts `never` and `on-request`. |
| `allowApiKeyAuth` | `false` | Permits an API-key login already owned by Codex; it does not expose an API key to the plugin or child environment. |
| `experimentalDynamicTools` | `false` | Enables the experimental DSH tool bridge and app-server experimental API. |
| `dynamicToolTimeoutMs` | `600000` | Integer from 1,000 through 3,600,000 ms for deferred tool calls and their incoming server requests. |
| `requestTimeoutMs` | `30000` | Integer from 1,000 through 300,000 ms for outgoing app-server requests. |
| `turnTimeoutMs` | `600000` | Integer from 1,000 through 3,600,000 ms. |

Transport controls remain bounded at 8 MiB per JSONL line, 64 KiB retained stderr, and 5 seconds for each TERM/KILL shutdown stage.

[PATH: src/app-server/client.ts] [PATH: src/app-server/transport.ts]

The child environment is generated from an explicit cross-platform allowlist. It includes PATH, user and Codex home paths, temporary and XDG directories, proxy variables, CA paths, locale, terminal, WSL, and Windows platform variables. It excludes ambient project and cloud credentials such as `GITHUB_TOKEN`, AWS secrets, npm tokens, Anthropic keys, and OpenAI keys. The result is the same when `allowApiKeyAuth` is true.

## Authentication boundary

The plugin reads normalized `account/read` status through app-server. It does not read the credential cache. Valid account kinds at the protocol boundary are currently `chatgpt`, `apiKey`, and `amazonBedrock`.

The subscription workflow must require `chatgpt`. If another mode is active, stop and let the user change the Codex login outside DSH.

## Models and reasoning

Models come from `model/list`. The adapter preserves upstream model IDs and supported reasoning efforts, filters hidden entries by default, and exposes the discovered catalog to DSH. The verified profile displayed seven models.

## Replay and restart

For a persistent DSH session, the adapter checks the newest assistant message from the same provider for version 1 replay state. A valid envelope or direct replay object resumes the recorded Codex thread and advances a bounded cursor through the last historical user message.

An invalid newest same-provider replay never falls back to an older thread. Malformed replay, replay from another provider, and replay on an ephemeral request start a new thread safely. Dynamic-tool threads are not replayable after process restart and fail with `DYNAMIC_TOOL_REPLAY_UNSUPPORTED`; create a new DSH session. The in-memory stable-session cache holds at most 256 states and evicts the oldest inactive entry.

## Forbidden settings

Do not add settings for:

- OpenAI API keys or bearer tokens;
- `auth.json`, `CODEX_HOME`, or keychain paths;
- OAuth client IDs, secrets, redirect URIs, or refresh tokens;
- telemetry or remote log destinations;
- raw shell commands;
- unbounded dynamic-tool catalogs, results, or timeouts.

## Experimental dynamic tools

Enable the bridge only in a persistent DSH session. The tool catalog is fixed for the Codex thread; schema drift fails closed. DSH executes each emitted call and returns text results through its normal next-step tool-result message. Images and audio are not accepted in 0.2.

## Related

- [Setup](../howto/setup.md)
- [Common issues](../troubleshooting/common-issues.md)
- [Security](security.md)
