---
title: "ADR-001: Use Codex App Server as the Provider Boundary"
category: decisions
service: dsh-codex
tags: [architecture, codex, app-server, authentication, dsh]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Selects the official Codex app-server stdio protocol for ChatGPT subscription access from DeepSeek Harness."
---

# ADR-001: Use Codex App Server as the Provider Boundary

## Status

Accepted, implemented for the 0.1 text and reasoning scope, and verified through a local tarball in an isolated DSH profile. The package remains unpublished.

## Context

The product goal is to expose an existing ChatGPT-funded Codex session as a DSH provider without making this plugin an OAuth client or token store.

OpenAI documents ChatGPT sign-in for subscription access. Codex stores and refreshes credentials. App-server exposes account state, conversations, approvals, streamed agent events, and model discovery over JSONL stdio.

Sources:

- [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server)
- [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth)
- [PATH: shared/rag-mcp/procedures/softspark-module-template.md]

## Options considered

| Option | Benefit | Rejection reason |
|---|---|---|
| Keep DSH status quo | No new plugin. | API providers do not reuse ChatGPT subscription access. |
| Adopt the community OAuth plugin | Existing DSH reference. | It owns OAuth credentials and creates another token store. |
| Integrate direct pi-ai Codex | Reuses an LLM abstraction. | It still needs credential ownership outside Codex. |
| Use official Codex app-server | Codex owns auth, models, agent execution, approvals, and built-in tools. | Accepted despite the need to test protocol compatibility. |

## Decision

Start `codex app-server` directly with `shell: false`. Communicate through validated JSONL on stdio. Initialize with `experimentalApi: false`.

Codex runs as the full agent inside DSH. The adapter maps DSH text input and emits text, reasoning, usage, cancellation, and finish state. Codex keeps its built-in tools, sandbox, approvals, and thread state.

Stable mode does not bridge DSH tool definitions and rejects tool-result continuation. ADR-002 adds a separately configured experimental bridge without changing this default.

## Verified outcome

The local tarball passed 92 unit and composition tests, live ChatGPT authentication, seven-model discovery, a direct adapter turn, HTTP 200 DSH boot, provider registration, same-thread replay across a host restart, and a live interrupted turn. A user screenshot confirmed GPT-5.6-Sol with `xhigh` reasoning.

## Consequences

- The plugin never reads Codex credential stores.
- There is no direct Responses API client.
- Codex CLI compatibility remains a tested runtime dependency.
- The host supplies Cordis and DSH peer seams.
- Dynamic tool bridging is governed by ADR-002 and its threat controls.

## Revisit trigger

Revisit when the stable app-server contract breaks, DSH tool bridging becomes required, OpenAI stabilizes `dynamicTools`, or app-server stops supporting local ChatGPT-authenticated execution.
