---
title: "dsh-codex verification on 2026-09-06"
category: procedures
service: dsh-codex
version: "1.0.0"
tags: [verification, release, provenance, compatibility]
created: "2026-09-06"
last_updated: "2026-09-06"
description: "Separates published 1.4.0 checks from the local 1.5.0 compatibility candidate."
---

# Verification on 2026-09-06

## Published artifact: 1.4.0

- npm integrity: `sha512-+5OB3BfCbGmRQJIUjsg/pYxBjd2JV0f7fulldVhCuo6UClbrzuEHa9k5axdssnlpEfTdBLCfzgxca1l7dXxedQ==`.
- Registry metadata contains a SLSA provenance v1 attestation and registry signature.
- A clean `npm install --ignore-scripts --save-exact @softspark/dsh-codex@1.4.0 @softspark/dsh-orchestrator@1.1.0` verified 461 registry signatures and 60 attestations with `npm audit signatures`; `npm audit --audit-level=high --json` reported zero vulnerabilities.
- The published adapter, imported from that clean installation, started the real Codex app server. Codex CLI `0.153.4` reported ChatGPT login; model discovery returned seven models. `gpt-5.6-sol` returned `DSH_CODEX_SMOKE_OK` with finish reason `stop`.
- The exact published pair also installed through pnpm `11.24.0` into a separate DSH `0.1.1-rc.2` profile. Its web host booted, the composed `llm` service listed seven Codex models and returned `DSH_HOST_CODEX_OK`; native Copilot Gemini returned `DSH_GEMINI_CHILD_OK`. The old Claude SDK failed its child request and is documented in the orchestrator record.
- The smoke adapter used a disposable working directory and `read-only` sandbox with `untrusted` approvals. No credential file was read, copied or changed by the test script.

## Local candidate: 1.5.0

- Node `22.22.2`, npm `11.13.0`, pnpm `11.24.0`.
- DSH `0.1.2-rc.1`: required-file, version, KB, TypeScript, ESLint, full coverage suite, build, source audit and permission audit passed. All 154 tests passed; coverage was 88.66% statements, 82.46% branches, 91.11% functions and 91.09% lines.
- DSH `0.1.1-rc.2` attachment/LLM/session seams: after a temporary dependency switch, TypeScript and the same 154 tests passed. The checked-in latest lockfile was restored with `npm ci --ignore-scripts`.
- Four regression cases failed before the permission fix and passed afterwards: newer interactive/unknown/missing approval state cannot restore an older `never`, and malformed newest sandbox state cannot restore older full access. A real DSH Session integration covers the event API and latest-policy behavior.
- Candidate dependency audit: zero vulnerabilities, 167 verified signatures and 56 attestations.
- A local tarball installed through the real DSH profile manager with pnpm `11.24.0`; the disposable web profile loaded the Codex provider and seven models. A request through the host's real `llm` service returned `DSH_HOST_CODEX_OK`.
- The browser's Codex parent invoked both delegation tools and received the exact Claude and Gemini markers. In a separate cancellation check, the parent issued `sleep 60`; Stop generating produced the paired `AbortError/ABORTED` tool result after 144 ms. The process returned to idle, no running tool rows remained, the Send action was restored, and the browser recorded no errors.
- After restarting with the final UI artifacts, the Codex parent invoked the native `subagent` tool, received `UI_NATIVE_CHILD_20260906`, and completed without browser errors. The installed browser bundles were byte-identical to the builds from the original repositories.

## Limits and release gate

The `1.5.0` candidate has not been published. Its local tarball checks do not establish registry provenance for a future release. Repeat this SOP against the exact published version and link this record from its release page. The current browser cancellation and restart-recovery checks passed.

The regular user DSH installation has not been located or upgraded. All runtime work used disposable profiles with `DSH_TELEMETRY_DISABLED=1`.
