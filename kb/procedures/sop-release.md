---
title: "SOP: Release dsh-codex"
category: procedures
service: dsh-codex
tags: [sop, release, npm, provenance, signatures]
created: "2026-08-26"
last_updated: "2026-08-27"
description: "Versions, verifies, tags, publishes, and verifies a provenance-signed public npm release."
---

# SOP: Release dsh-codex

## Purpose

Publish a traceable npm package only after DSH composition and Codex compatibility gates pass.

## Prerequisites

- The first public release of every SoftSpark module is `1.0.0`; `0.x` tags and publications are forbidden. Subsequent releases follow Semantic Versioning from the latest published tag.
- The package is approved for publication.
- Maintainer access to `softspark/dsh-codex` and `@softspark` on npm.
- npm trusted publishing or an `NPM_TOKEN` secret configured in GitHub.
- GitHub Actions OIDC permission `id-token: write`.
- A clean `main` branch with green CI.
- A tested Codex CLI version recorded in release notes.
- Completed post-release rollback owner assignment.

## Procedure

### 1. Prepare the version

- [ ] Update `package.json` and `package-lock.json` to the same semantic version.
- [ ] Move CHANGELOG entries from Unreleased to the release date.
- [ ] Update README and KB compatibility statements.
- [ ] Confirm the DSH composition test and real-client smoke test pass.

```bash
npm run verify:version
```

### 2. Run the complete local gate

```bash
npm ci --ignore-scripts
npm run verify
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run audit
npm run audit:permissions
npm run audit:dependencies
npm run audit:signatures
npm run package:check
```

- [ ] No lifecycle script exists.
- [ ] No high or critical audit result exists.
- [ ] Dependency signatures verify.
- [ ] The package dry run contains only the approved artifact surface.

### 3. Review release workflow controls

```bash
rg -- '--provenance' .github/workflows/publish.yml
rg -- 'id-token: write' .github/workflows/publish.yml
rg -- '--ignore-scripts' .github/workflows/publish.yml
```

The publish command must remain:

```bash
npm publish --provenance --access public --ignore-scripts
```

See the SoftSpark module standard: [PATH: shared/rag-mcp/procedures/softspark-module-template.md].

### 4. Commit and tag

After explicit maintainer approval:

```bash
git commit -m "chore: release vX.Y.Z"
git tag vX.Y.Z
git push origin main
git push origin vX.Y.Z
```

The `v*` tag starts the publish workflow. The workflow must not commit or push repository changes.

### 5. Observe publication

- [ ] All workflow gates pass.
- [ ] npm publication reports provenance.
- [ ] The SARIF upload succeeds.
- [ ] GitHub Release is created from the tag.

## Verification

Run the [post-release SOP](sop-post-release-testing.md). A GitHub Release alone is not evidence that npm contents, provenance, signatures, authentication mode, or DSH integration work.

## Rollback

If publication is defective:

1. Stop promotion and announce the affected version.
2. Deprecate the exact package version instead of deleting history:

```bash
npm deprecate @softspark/dsh-codex@X.Y.Z "Do not use: REASON"
```

3. Fix forward with a new version and changelog entry.
4. Remove or replace a GitHub Release only after preserving the audit trail.
5. Never reuse or move the published tag.
