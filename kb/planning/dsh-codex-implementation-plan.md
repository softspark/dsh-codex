---
title: "dsh-codex Implementation Plan"
category: planning
service: dsh-codex
tags: [planning, implementation, dsh, codex, release]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Records verified implementation phases and the remaining publication work for dsh-codex."
---

# dsh-codex Implementation Plan

## Status

In progress because publication and live subscription-subagent smoke are pending. The stable provider and opt-in 0.2 dynamic-tool bridge are implemented and verified in tests.

The package remains unpublished.

## Objective

Run a ChatGPT-authenticated Codex agent as DSH provider `codex` without plugin-owned credentials, custom OAuth, direct OpenAI API calls, or telemetry, with an explicit opt-in bridge to DSH tools.

## Current scope

### Included

- Official `codex app-server` over JSONL stdio.
- Stable API with `experimentalApi: false`.
- ChatGPT authentication enforcement by default.
- Seven-model discovery in the verified environment.
- DSH text input, text and reasoning streaming, usage, stop state, same-provider replay resume, session mapping, and bounded cancellation.
- Minimal cross-platform child environment with ambient project and cloud credentials removed.
- Source build, local tarball, Cordis composition, isolated DSH boot, provider registration, selector exposure, and one end-to-end DSH prompt.
- Apache-2.0 package controls with no lifecycle scripts.
- Opt-in bounded dynamic-tool catalog, canonical DSH execution, and same-turn continuation.

### Future scope

- Image, audio, and other multimodal conversion.
- Remote app-server transports.
- Publication and post-release verification.

Codex built-in tools run internally. Stable mode keeps DSH tools unavailable. Opt-in dynamic mode bridges only schemas and correlated text results; DSH remains the executor.

## Verified dependencies

| Dependency | Verified contract |
|---|---|
| Node.js | 22.19.0 or newer |
| Codex CLI | 0.149.1, with TypeScript schema generated and reconciled |
| `@deepseek-ai/cordis` | Peer 4.0.1, supplied by the DSH host |
| `@deepseek-ai/dsh-llm` | Peer 0.1.1-rc.2, supplied by the DSH host |
| `@deepseek-ai/schemastery` | Runtime 3.18.1 |
| DSH profile | Isolated profile used for tarball install and web smoke |

## Evidence

| Gate | Result |
|---|---|
| Unit, protocol, bridge, and composition tests | 131/131 passed |
| Coverage | 88.98 percent statements, 82 percent branches, 91.32 percent lines |
| Generated protocol contract | Codex CLI 0.149.1 TypeScript schema generated and reconciled |
| Live app-server | `authKind=chatgpt`, seven models |
| Direct adapter turn | Exact test marker, finish `stop`, usage present |
| Tarball | 51.8 kB, SHA-256 `6dcfc50389e020d68015945a2222ed5a442d83fb2166efb3a0be905520c04188` |
| Isolated DSH install | Local tarball installed and provider loaded |
| DSH web boot | HTTP 200 |
| DSH provider catalog | Provider `codex`, seven models |
| DSH end-to-end prompt | Expected marker returned |
| DSH restart replay | Same session returned the remembered nonce with the identical Codex thread ID |
| DSH interruption | Active turn ended with reason `aborted` |
| User verification | Screenshot shows GPT-5.6-Sol with `xhigh` reasoning |

No Context7 or RAG corpus state is required to establish these repository results.

## Phases

### Phase 0: Repository and supply-chain foundation

Status: verified complete.

- [x] Apache-2.0 LICENSE and NOTICE.
- [x] Strict ESM TypeScript package and exact lockfile.
- [x] Multi-OS CI and provenance publish workflow.
- [x] SARIF audit, permission report, dependency and signature gates.
- [x] KB, repository governance, and deterministic KB validation.
- [x] Package surface and local tarball inspection.

### Phase 1: Stable app-server tracer bullet

Status: verified complete.

- [x] Direct child-process transport with `shell: false`.
- [x] JSONL framing, size bounds, stderr bounds, and shutdown escalation.
- [x] Stable initialize handshake with experimental API disabled.
- [x] Account, model, thread, turn, interruption, notification, and usage handling.
- [x] Protocol failures escalate TERM to bounded KILL and release process listeners.
- [x] Server-request result plus error-reply failure closes the client without an unhandled rejection.
- [x] Incoming server-request handlers time out and receive an abort signal.
- [x] Codex CLI 0.149.1 TypeScript schema generation and reconciliation.
- [x] Live app-server smoke with ChatGPT auth and seven models.
- [x] Direct adapter marker, stop state, and usage smoke.

### Phase 2: DSH provider adapter

Status: verified complete for text and reasoning.

- [x] Provider route `codex`.
- [x] Text input, model and reasoning selection, streaming, usage, replay state, and stop mapping.
- [x] Same-provider replay resumes after restart and skips historical user IDs; malformed, foreign, and ephemeral replay falls back safely.
- [x] Invalid newest same-provider replay cannot fall back to an older thread.
- [x] The 256-entry inactive-session LRU bounds adapter state and recovers through replay.
- [x] Child environment uses an explicit runtime allowlist and drops ambient project and cloud secrets.
- [x] ChatGPT authentication enforcement with optional Codex-owned API-key mode.
- [x] Fail-closed unsupported content, DSH tool result, and dynamic-tool behavior.
- [x] Unit and composition coverage above 70 percent.
- [x] Adapter turn smoke against live app-server.

### Phase 3: Local tarball and DSH composition

Status: verified complete.

- [x] Cordis patch and package entry.
- [x] 51.8 kB local 0.2.0 tarball with SHA-256 `6dcfc50389e020d68015945a2222ed5a442d83fb2166efb3a0be905520c04188`.
- [x] Installation into isolated `DSH_HOME`.
- [x] DSH host supplied Cordis and LLM peer seams despite `autoInstallPeers=false`.
- [x] DSH web boot returned HTTP 200.
- [x] Provider `codex` exposed seven models.
- [x] End-to-end DSH prompt returned the expected marker.
- [x] User screenshot confirmed GPT-5.6-Sol at `xhigh`.
- [x] No plugin API key or duplicate peer install was required.
- [x] Stable mode advertised no DSH tools; dynamic mode requires explicit configuration.
- [x] Same-provider replay retained the identical Codex thread ID across a DSH restart.
- [x] A real interruption smoke ended an active DSH turn with reason `aborted`.

### Phase 4: Dynamic tools orchestration bridge

Status: implemented and locally verified.

- [x] Stable mode remains unchanged and fail closed.
- [x] Bounded DSH schemas map to app-server dynamic tools.
- [x] DSH executes calls through its normal agent loop.
- [x] Tool results are atomically correlated and resume the same Codex turn.
- [x] Abort, timeout, invalid batch, close, and restart-pending paths fail closed.
- [x] Real `LlmRuntime.prepareCall()` and parallel-session model caching are covered.
- [x] Isolated DSH completed a real `todo_write` dynamic-tool roundtrip on the SoftSpark Orchestrator preset.

### Phase 5: Publication

Status: pending.

- [x] Complete final full-repository review.
- [x] Record DSH 0.1.1-rc.2 and full tarball SHA-256.
- [ ] Create the approved release commit and `v*` tag.
- [ ] Publish with npm provenance and `--ignore-scripts`.
- [ ] Verify registry provenance, signatures, contents, and clean-install smoke.
- [ ] Deprecate and fix forward if any post-release gate fails.

## Success criteria

| Criterion | Status |
|---|---|
| Repository quality gates and coverage pass | Verified |
| Local package installs without lifecycle scripts | Verified |
| DSH loads provider `codex` | Verified |
| Seven models appear in DSH | Verified |
| ChatGPT-authenticated DSH prompt completes | Verified |
| Usage and stop state map through the adapter | Verified |
| Credential stores remain outside the plugin | Verified by design and tests |
| Malformed, oversized, timed-out, and credential-bearing data fails closed | Verified by tests |
| Real interruption inside DSH | Verified |
| Public npm provenance and post-release smoke | Pending |

## Remaining risks

| Risk | Current control |
|---|---|
| App-server protocol churn | Pin Codex 0.149.1 for the release candidate and rerun schema plus live smokes on upgrade. |
| DSH and Codex permission mismatch | Keep stable sandbox and approval mapping. DSH tools remain unbridged. |
| Credential leakage | Retain bounds, recursive redaction, and structural secret audits. |
| Host peer resolution changes | Do not duplicate peers. Repeat isolated install on every supported DSH version. |
| Long-running cancellation differs from tests | Repeat the verified live interruption smoke for every supported DSH or Codex upgrade. |
| Experimental tool pressure | Keep `experimentalApi: false` and require a new ADR before bridging. |

## Next checkpoint

Phase 4 starts only after explicit approval to create the release commit, tag, and public npm publication.
