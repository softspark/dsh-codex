---
title: "dsh-codex Architecture"
category: reference
service: dsh-codex
tags: [architecture, dsh, codex, json-rpc, stdio, images, recovery]
created: "2026-08-26"
last_updated: "2026-09-02"
description: "Defines the implemented runtime layers, trust boundaries, replay path, and verified DSH composition."
---

# dsh-codex Architecture

## Purpose

`dsh-codex` is an implemented DSH provider named `codex`. It embeds a locally authenticated Codex agent inside a DSH session without taking ownership of OpenAI credentials. Version `1.0.0` is the first public release.

## Component flow

```text
DSH session and model selector
        |
        | DSH LLM provider seam
        v
@softspark/dsh-codex adapter
        |
        | validated JSON-RPC, one JSON object per line
        v
codex app-server child process
        |
        | Codex-owned auth, thread state, sandbox, approvals, tools
        v
ChatGPT subscription or another Codex-selected account mode
```

OpenAI documents app-server as the rich-client interface for authentication, conversation history, approvals, and streamed agent events. Stdio is the default transport and carries JSONL. See [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server).

## Layers

| Layer | Responsibility | Current state |
|---|---|---|
| DSH plugin entry and Cordis patch | Register provider ID `codex` and expose the adapter to DSH. | Implemented and verified in an isolated profile. [PATH: src/index.ts] |
| DSH adapter | Convert DSH messages and generation options to Codex threads and turns. Convert Codex events to DSH stream chunks. | Implemented and verified for text, reasoning, usage, replay, and stop state. [PATH: src/adapter.ts] |
| App-server client | Initialize, read account state, list models, start or resume threads, start or interrupt turns, dispatch notifications, and bound requests. | Tracer bullet implemented and unit tested. [PATH: src/app-server/client.ts] |
| Child-process transport | Spawn `codex app-server --listen stdio://`, frame JSONL, bound output, and terminate the child. | Tracer bullet implemented and unit tested. [PATH: src/app-server/transport.ts] |
| Validation and redaction | Validate untrusted JSON values and remove credential-like data from errors. | Tracer bullet implemented and unit tested. [PATH: src/app-server/validation.ts] [PATH: src/app-server/redaction.ts] |

## Trust boundaries

### Credentials

Codex owns login details and token refresh. OpenAI documents that Codex caches credentials in `CODEX_HOME` or an OS credential store and refreshes ChatGPT tokens during use. This plugin must not open either store. See [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth).

### Process and JSONL

The child process is trusted to run Codex but its output is treated as untrusted input. The transport currently enforces:

- direct spawn with no shell;
- one JSON object per line;
- an 8 MiB line limit;
- a 64 KiB retained stderr limit;
- a 30 second default request timeout;
- a 5 second TERM stage followed by bounded KILL escalation;
- a minimal cross-platform child-environment allowlist that drops ambient project and cloud credentials;
- fail-closed client shutdown when both a server-request result and its error reply cannot be sent.

These values are implementation controls, not a stable public configuration contract.

### Agent seam

Codex is the full agent inside DSH. The adapter forwards text and emits text, reasoning, usage, replay, and finish state. Codex retains its own built-in tools, sandbox, and approvals. Stable mode does not inject DSH tools; opt-in dynamic mode registers a bounded catalog and routes calls back through the standard DSH agent loop.

Stable persistent sessions resume from a valid newest same-provider version 1 replay envelope or direct replay object after plugin restart. A bounded last-user cursor skips historical input. Dynamic-tool threads are deliberately non-replayable after restart because their registered catalog and server requests are process-local; continuation fails closed and requires a new DSH session.

## Turn loss and recovery

A turn can be lost while dynamic tool calls are outstanding: a timeout, an
interrupt, or an adapter restart. The pending turn is detached and its calls
are failed, and the results the client had already dispatched arrive with
nothing to answer.

Those stale results stay in the transcript for the life of the session, so
treating them as fatal made a single lost turn end the conversation. The guard
now fires only when the request carries no new user message — a genuine attempt
to answer a dead call. Otherwise the stale results are dropped and the thread is
resumed with its catalog.

`thread/resume` accepts `dynamicTools`; this was verified against the app-server
by starting a thread with a catalog, running one turn so a rollout exists, and
resuming it with the same catalog. Resuming a thread with no turn fails on the
missing rollout, which is unrelated to the catalog.

## Image input

Model modalities come from `model/list` rather than a fixed text-only claim.
User image blocks are resolved through the `ctx.attachments` service, which owns
the bytes and returns a request-encoded version for a stated pixel and byte
budget; the adapter base64-encodes that into a data URL and sends it on the
app-server's `image` user-input variant. The adapter never reads a filesystem
path carried in a message.

## Stable API policy

The client initializes with `experimentalApi: false` unless `experimentalDynamicTools` is explicitly enabled. Stable mode remains the supported default.

Dynamic mode maps DSH schemas to app-server `dynamicTools`. An `item/tool/call` becomes DSH tool-call chunks; after DSH executes it, the next adapter step validates the complete result batch before resuming the same Codex turn. The adapter never calls the DSH tool registry directly.

## Current tracer-bullet sequence

1. Start the child process over stdio.
2. Send `initialize` with stable capabilities.
3. Send the `initialized` notification.
4. Read account state and available models.
5. Start or resume a thread.
6. Start a turn with text input and optional reasoning effort.
7. Parse agent text, reasoning deltas, and turn completion.
8. Interrupt or close on cancellation and protocol failure.

The DSH-facing adapter, Cordis registration, local tarball, model catalog, HTTP 200 boot, end-to-end prompt, same-thread replay across a host restart, and an aborted live turn are verified.

## Related documents

- [App-server protocol](app-server-protocol.md)
- [Configuration](configuration.md)
- [Security](security.md)
- [ADR-001](../decisions/adr-001-codex-app-server.md)
- [ADR-002](../decisions/adr-002-dynamic-tools-bridge.md)
- [Implementation plan](../planning/dsh-codex-implementation-plan.md)
