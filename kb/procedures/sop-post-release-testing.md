---
title: "SOP: Post-Release Testing"
category: procedures
service: dsh-codex
version: "1.0.0"
tags: [sop, post-release, npm, provenance, smoke-test]
created: "2026-08-26"
last_updated: "2026-09-06"
description: "Verifies npm provenance, signatures, package contents, Codex authentication, and DSH composition after release."
---

# SOP: Post-Release Testing

## Purpose

Prove that the public artifact, not the maintainer checkout, works with the declared Codex and DSH versions.

## Prerequisites

- Published version `X.Y.Z`.
- Node.js 22.19 or newer.
- Codex CLI at the release-tested version.
- ChatGPT-authenticated Codex CLI.
- A disposable directory and isolated `DSH_HOME`.
- A recorded rollback owner.

## Procedure

### 1. Verify registry metadata

```bash
npm view @softspark/dsh-codex@X.Y.Z version dist.integrity dist.tarball
npm view @softspark/dsh-codex@X.Y.Z engines peerDependencies
npm view @softspark/dsh-codex@X.Y.Z dist.attestations dist.signatures --json
```

- [ ] Version and peer seams match the release.
- [ ] npm displays provenance for the release page.
- [ ] The tag and package version match.

### 2. Install in isolation

```bash
SMOKE_DIR="$(mktemp -d)"
cd "$SMOKE_DIR"
npm init -y
npm install --ignore-scripts --save-exact @softspark/dsh-codex@X.Y.Z
npm audit signatures
npm audit --audit-level=high
```

- [ ] No lifecycle script runs.
- [ ] Signature verification succeeds.
- [ ] No high or critical finding exists.

### 3. Inspect contents

```bash
npm pack --dry-run --ignore-scripts @softspark/dsh-codex@X.Y.Z
```

- [ ] `lib/`, `cordis.patch.yml`, README, CHANGELOG, LICENSE, and NOTICE exist.
- [ ] `src/`, `tests/`, `kb/`, `.agents/`, `.claude/`, and `.codex/` do not ship.

### 4. Verify Codex authentication

```bash
codex --version
codex login status
codex app-server --help
```

- [ ] Authentication mode is ChatGPT.
- [ ] No plugin step reads or copies Codex credential files.

### 5. Run isolated DSH composition smoke

Set `DSH_HOME` to a disposable path, select the release's compatible DSH host, and install the exact registry artifact:

```bash
export DSH_HOME="$SMOKE_DIR/dsh-home"
dsh plugin --profile web add @softspark/dsh-codex@X.Y.Z --save-exact --ignore-scripts
dsh --profile web --dump-default-config
dsh --profile web --no-open --host 127.0.0.1 --port 0
```

Version `1.4.0` uses DSH `0.1.1-rc.2`. Candidate `1.5.0` supports that host and `0.1.2-rc.1`; run against each claimed host after publication.

- [ ] Provider ID `codex` loads without another provider configuration.
- [ ] Model discovery returns the tested model set.
- [ ] A text prompt streams assistant text and reasoning.
- [ ] Cancellation terminates the active turn.
- [ ] Malformed protocol and timeout tests remain fail-closed.
- [ ] DSH and Codex approval or sandbox prompts are not silently bypassed.
- [ ] Stable mode advertises no DSH tools; dynamic tools appear only when `experimentalDynamicTools: true` is configured.

Keep the native Codex login outside this profile. Never copy credential files into the test directory.

## Verification

Record the npm version, integrity, provenance result, signature result, Node/npm/pnpm versions, Codex version, DSH version, authentication mode, model ID, cancellation and smoke result in a dated KB verification record and link it from the GitHub Release. Separate published-artifact results, local candidate results, and unexecuted checks. See the [2026-09-06 record](verification-2026-09-06.md).

## Rollback

On any failure:

1. Stop recommending the release.
2. Deprecate the exact npm version with a concrete reason.
3. Restore the previous known-good DSH profile in the disposable environment.
4. Preserve sanitized logs and the failing artifact digest.
5. Fix forward with a new semantic version. Never overwrite the published tag.
