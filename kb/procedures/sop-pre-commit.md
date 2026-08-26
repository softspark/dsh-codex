---
title: "SOP: Pre-Commit Quality Gate"
category: procedures
service: dsh-codex
tags: [sop, pre-commit, testing, security, packaging]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Runs deterministic code, test, security, documentation, and package checks before a dsh-codex commit."
---

# SOP: Pre-Commit Quality Gate

## Purpose

Prevent protocol, security, documentation, and package drift before code enters history.

## Prerequisites

- Node.js 22.19 or newer.
- Reviewed `package-lock.json`.
- Codex CLI for protocol or composition changes.
- Clean awareness of user-owned files. Preserve `.idea/` and unrelated work.

## Procedure

### 1. Inspect scope

- [ ] Run `git status --short`.
- [ ] Read the complete diff.
- [ ] Confirm the change includes matching tests and documentation.
- [ ] Confirm no credential, auth cache, token, log, tarball, or generated `lib/` output is staged.

### 2. Install the reviewed graph

```bash
npm ci --ignore-scripts
```

- [ ] Review dependency and lockfile changes.
- [ ] Confirm `package.json` contains no lifecycle scripts.

### 3. Run repository gates

```bash
npm run verify
npm run typecheck
npm run lint
npm run test:coverage
npm run build
```

- [ ] Coverage is at least the configured 70 percent threshold.
- [ ] Protocol changes include malformed, timeout, cancellation, and redaction cases.

### 4. Run security and supply-chain gates

```bash
npm run audit
npm run audit:permissions
npm run audit:dependencies
npm run audit:signatures
npm run package:check
```

- [ ] No high or critical dependency finding remains.
- [ ] Permission output matches the documented child-process-only runtime surface.
- [ ] Package output excludes source tests, KB, local agent files, credentials, and settings.
- [ ] `LICENSE` and `NOTICE` ship in the artifact.

### 5. Check documentation and diff hygiene

```bash
git diff --check
git diff --cached --check
```

- [ ] Every `kb/**/*.md` file has the seven required frontmatter fields.
- [ ] Category matches its directory.
- [ ] New behavior appears in README, CHANGELOG, and the relevant KB page.
- [ ] The commit message follows Conventional Commits.

Documentation and package conventions come from [PATH: shared/rag-mcp/procedures/softspark-module-template.md].

## Verification

The gate passes only when every command exits zero and the final diff contains no orphaned references, stale docs, missing tests, secrets, or unrelated files.

## Rollback

Do not commit on failure. Revert only the task-owned edits or restore them from a known patch. Keep user-owned work intact. If generated output caused the failure, regenerate it from the pinned source rather than editing it by hand.
