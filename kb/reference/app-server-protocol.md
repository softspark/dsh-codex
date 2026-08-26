---
title: "Codex App-Server Protocol Surface"
category: reference
service: dsh-codex
tags: [codex, app-server, json-rpc, protocol, streaming]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Records stable app-server methods, replay validation, and fail-closed process behavior used by dsh-codex."
---

# Codex App-Server Protocol Surface

## Upstream contract

The official app-server documentation is the protocol authority: [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server).

The local process starts with:

```bash
codex app-server --listen stdio://
```

Stdio is the default transport. Each direction carries one JSON object per line. Schema output is tied to the Codex CLI version that generated it:

```bash
codex app-server generate-ts --out ./schemas
codex app-server generate-json-schema --out ./schemas
```

Generated bindings must be reviewed and never hand-edited.

## Initialization

The client sends `initialize`, validates the result, then sends `initialized`. It explicitly requests the stable API:

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "softspark_dsh_codex",
      "title": "SoftSpark DSH Codex",
      "version": "0.2.0"
    },
    "capabilities": {
      "experimentalApi": false,
      "requestAttestation": false
    }
  }
}
```

## Tracer-bullet methods

| Method | Use | Validation |
|---|---|---|
| `account/read` | Confirm active authentication and distinguish `chatgpt` from other account modes. | Returns only normalized auth status to the adapter. |
| `model/list` | Discover models, hidden state, default model, input modalities, and reasoning efforts. | Cursor loops and a 100-page limit are enforced. |
| `thread/start` | Create a Codex thread for a DSH session. | Stable thread options only. |
| `thread/resume` | Restore a previously mapped Codex thread. | Requires a non-empty thread ID. |
| `turn/start` | Submit text input with optional model and effort. | Input must be valid JSON and match supported user-input shapes. |
| `turn/interrupt` | Cancel an active turn. | Requires thread and turn IDs. |

[PATH: src/app-server/client.ts]

## Streamed events

The current parser recognizes:

- `item/agentMessage/delta` for assistant text;
- `item/reasoning/summaryTextDelta` for reasoning summaries;
- `item/reasoning/textDelta` for reasoning text;
- `turn/completed` for terminal turn state.

Unknown or malformed tracer-bullet events fail closed. Error payloads are redacted before they become application errors. [PATH: src/app-server/validation.ts]

## Request lifecycle

Outgoing requests use monotonically increasing safe integer IDs, default to 30 seconds, and accept an `AbortSignal`. Dynamic `item/tool/call` handlers use `dynamicToolTimeoutMs`, default 10 minutes, and receive an aborted signal on timeout. Closing the transport rejects pending requests and aborts active server-request handlers.

Malformed JSON, invalid UTF-8, oversized lines, and handler failures close the connection. Protocol failure closes stdin, sends TERM, waits the bounded shutdown period, and escalates to KILL when the child does not exit.

Server requests are fail closed. If sending a handler result fails, the client attempts an error response. If that second send also fails, pending requests are rejected and the client closes without producing an unhandled rejection.

## Replay after restart

A persistent DSH request can resume a Codex thread from assistant replay state owned by provider `codex`. The adapter accepts either the DSH envelope form under `response` or the direct response object. Both require version 1 plus non-empty `threadId` and `turnId`.

The adapter advances a bounded cursor through the last user message before the replay-bearing assistant and sends only newer input. The newest same-provider assistant is authoritative: invalid replay starts a new thread and never falls back to an older state. Another provider's state and ephemeral requests do not resume.

## Dynamic tools

OpenAI marks `dynamicTools` and `item/tool/call` as experimental. They require `capabilities.experimentalApi = true`.

Version 0.2 enables dynamic tools only when configured. Tool schemas are sent during `thread/start`; `item/tool/call` is translated to the canonical DSH tool-call stream. Codex waits while DSH executes the call, and the next `stream()` returns an atomically validated text result to the same server request.

The bridge bounds 128 tools, 16 pending calls, 128 calls per turn, 256 KiB arguments, 1 MiB result batches, 256-byte call IDs, and a configurable tool timeout. Namespace calls, non-text results, schema drift, mismatched IDs, partial batches, and all dynamic-thread replay after restart fail closed.

## Compatibility rule

Pin a tested Codex CLI version for release validation. Regenerate schemas and run protocol tests when the CLI changes. A green TypeScript build alone does not establish wire compatibility.
