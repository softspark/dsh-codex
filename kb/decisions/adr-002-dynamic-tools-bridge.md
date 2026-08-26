---
title: "ADR-002: Opt-in Codex Dynamic Tools Bridge"
category: decisions
service: dsh-codex
tags: [adr, codex, dsh, dynamic-tools, security]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Selects a bounded two-step bridge from Codex app-server dynamic tools to the standard DSH tool-result loop."
---

# ADR-002: Opt-in Codex Dynamic Tools Bridge

## Context

Codex is the subscription-backed primary agent, while Claude Code and Gemini ACP are DSH subagents. Codex can delegate only if DSH tool definitions cross the app-server boundary. Direct tool execution inside the adapter would bypass the DSH agent loop, permissions, logging, and canonical tool-result history.

## Decision

Keep stable mode unchanged and introduce `experimentalDynamicTools: true` as an explicit opt-in. The adapter sends a fixed, bounded tool catalog during `thread/start`. When Codex requests a tool, the adapter emits canonical DSH tool-call chunks and finishes the step with `tool-calls`. DSH executes the tool normally. The next DSH step supplies correlated text results, which are validated as a complete batch before the adapter responds to the waiting app-server request and continues the same Codex turn.

The adapter never invokes DSH tools directly. Invalid or partial batches reject every pending call and interrupt the Codex turn exactly once. Pending dynamic calls are process-local and cannot be replayed after restart.

## Controls

- 128 tools and 128 calls per turn.
- 16 concurrently pending calls.
- 128-byte names, 16 KiB descriptions, 64 KiB per schema, and 512 KiB catalog.
- 256 KiB arguments, 256-byte call IDs, and 1 MiB text-result batches.
- Configurable 1-second to 1-hour deferred-call timeout, default 10 minutes.
- Atomic correlation, schema fingerprinting, complete model-catalog snapshots, and idempotent interruption.
- Text-only results in 0.2; image and audio fail closed.

## Consequences

`@softspark/dsh-orchestrator` can expose `subagent_claude_code`, `subagent_gemini`, and workflow tools to Codex without introducing another OAuth store. The bridge depends on an experimental app-server API and therefore requires pinned Codex compatibility tests before each release.

## Revisit trigger

Revisit when app-server stabilizes dynamic tools, DSH changes its tool-result contract, or safe attachment conversion is required.
