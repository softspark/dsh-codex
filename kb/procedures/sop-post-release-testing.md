---
title: "SOP: Post-Release Testing"
category: procedures
service: dsh-codex
tags: [sop, post-release, npm, provenance, smoke-test]
created: "2026-08-26"
last_updated: "2026-08-26"
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

Set `DSH_HOME` to a disposable path. Install the released tarball into the tested DSH profile using the command recorded by the release composition test.

- [ ] Provider ID `codex` loads without another provider configuration.
- [ ] Model discovery returns the tested model set.
- [ ] A text prompt streams assistant text and reasoning.
- [ ] Cancellation terminates the active turn.
- [ ] Malformed protocol and timeout tests remain fail-closed.
- [ ] DSH and Codex approval or sandbox prompts are not silently bypassed.
- [ ] No dynamic DSH tools are advertised in the 0.1 release.

Do not improvise the DSH install command. Copy it from the release-tested setup document after it exists.

## Verification

Record the npm version, integrity, provenance result, signature result, Node version, Codex version, DSH version, authentication mode, model ID, and smoke result in the GitHub Release verification note.

## Rollback

On any failure:

1. Stop recommending the release.
2. Deprecate the exact npm version with a concrete reason.
3. Restore the previous known-good DSH profile in the disposable environment.
4. Preserve sanitized logs and the failing artifact digest.
5. Fix forward with a new semantic version. Never overwrite the published tag.
