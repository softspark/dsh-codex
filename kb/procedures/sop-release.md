---
title: "SOP: Release dsh-codex"
category: procedures
service: dsh-codex
version: "1.1.0"
tags: [sop, release, npm, provenance, signatures, local-gates]
created: "2026-08-26"
last_updated: "2026-09-24"
description: "Prepares a release commit and runs the single local release command that gates, tags, publishes, and verifies a provenance-signed npm release."
---

# SOP: Release dsh-codex

```bash
npm run release -- X.Y.Z             # gates, Linux run, pack smoke, signed tag, push, watch publish
npm run release -- X.Y.Z --dry-run   # everything up to the tag, then prints the rest
```

## Purpose

Publish a traceable npm package only after DSH composition and Codex compatibility gates pass on the maintainer's machine.

`scripts/release.sh` is the only supported way to create a release tag. GitHub Actions no longer tests anything: there is no CI on pushes or pull requests, and `publish.yml` only turns a tag into an npm package and a GitHub Release. A tag made by hand ships whatever the commit holds, gated or not. The shared model is the SoftSpark SOP "Local Release Gates, Publish-Only CI"; this page keeps what is specific to dsh-codex.

## Prerequisites

- The first public release of every SoftSpark module is `1.0.0`; `0.x` tags and publications are forbidden. Subsequent releases follow Semantic Versioning from the latest published tag.
- The package is approved for publication.
- Maintainer access to `softspark/dsh-codex` and `@softspark` on npm.
- npm trusted publishing or an `NPM_TOKEN` secret configured in GitHub.
- GitHub Actions OIDC permission `id-token: write`.
- npm `11.13.0` (the `packageManager` version). The legacy DSH install resolves differently under other npm releases, so the script refuses any other.
- Docker running, for the Linux run.
- Git configured to SSH-sign tags. Release tags are signed; an unsigned tag stops the script before anything is pushed.
- A tested Codex CLI version recorded in release notes.
- Completed post-release rollback owner assignment.

## Procedure

### 1. Prepare the release commit

The script checks these; it does not write them.

- [ ] Update `package.json`, `package-lock.json` and `DEFAULT_CLIENT_INFO.version` in `src/app-server/client.ts` to the same semantic version.
- [ ] Move CHANGELOG entries from Unreleased to `## [X.Y.Z] - YYYY-MM-DD`.
- [ ] Update README and KB compatibility statements.
- [ ] Confirm the DSH composition test and real-client smoke test pass.

```bash
npm run verify:version
git commit -m "chore: release vX.Y.Z"
git push origin main
```

### 2. Release

After explicit maintainer approval:

```bash
npm run release -- X.Y.Z
```

It stops at the first failure. Logs and the SARIF report go to `${TMPDIR:-/tmp}/dsh-codex-release-X.Y.Z/`.

| Step | What it checks or does |
|---|---|
| 1. Preconditions | on `main`, clean tree, `main` equals `origin/main` after a fetch, `X.Y.Z` is semver, `vX.Y.Z` exists neither locally nor on origin |
| 2. Version and notes | `verify-version-sync.mjs --tag vX.Y.Z` (manifest, both lockfile fields, clientInfo), a dated `## [X.Y.Z]` CHANGELOG heading, `HEAD` is `chore: release vX.Y.Z` |
| 3. Gates | npm version, `npm ci --ignore-scripts`, `verify`, `typecheck`, `lint`, `test:coverage` (70 percent threshold), `build`, `audit:dependencies`, `audit:signatures`, `audit`, `audit:permissions`, SARIF generation, `package:check`, publish controls in `publish.yml`, then DSH `0.1.1-rc.2` compatibility (typecheck and tests against the older host seams, in a scratch copy so the checkout keeps the locked graph) |
| 4. Linux run | the same gate in a throwaway `node:24` container with npm `11.13.0`, repository copied in, run as the non-root `node` user |
| 5. Build and smoke | `npm pack`; the tarball must carry `lib/`, `cordis.patch.yml`, `LICENSE` and `NOTICE` and no sources, tests, KB or scripts; its `lib/index.js` is imported once and must export `name` `dsh-codex` and an `apply` function |
| 6. Tag and push | SSH-signed tag `vX.Y.Z` (`Release vX.Y.Z`) on `HEAD`, push `main`, then `git push origin refs/tags/vX.Y.Z` |
| 7. Watch publish | `gh run watch` on the tag's `publish.yml` run, then `npm view @softspark/dsh-codex@X.Y.Z` and the GitHub Release |

- [ ] No lifecycle script exists.
- [ ] No high or critical audit result exists.
- [ ] Dependency signatures verify.
- [ ] The package dry run contains only the approved artifact surface.

**Why the Linux run applies here.** The app-server transport spawns and signals a child process, and vitest, rollup and the coverage provider load platform-native binaries; `npm ci` inside the container installs the Linux builds. The old CI also ran the suite on Windows. Nothing local replaces that, so Windows-specific process handling is covered only by review.

**SARIF is no longer uploaded.** CI used to push the audit SARIF to GitHub code scanning on every push. The script writes it to the log directory instead; attach it to the release notes if a finding needs a record.

### 3. What publish.yml still does

On a `v*` tag: checkout, Node `22.19.0`, `verify-version-sync.mjs --tag` (the tag must equal every version surface), `npm ci --ignore-scripts` and `npm run build` because `lib/` is not committed, then:

```bash
npm publish --provenance --access public --ignore-scripts
```

and the GitHub Release. No test, lint or audit step. The workflow must not commit or push repository changes. Step 3 of the script reads `publish.yml` with comments stripped and refuses to continue unless it still carries `--provenance`, `id-token: write` and `--ignore-scripts`.

See the SoftSpark module standard: [PATH: shared/rag-mcp/procedures/softspark-module-template.md].

## Verification

Run the [post-release SOP](sop-post-release-testing.md). The script has already confirmed the registry version and the GitHub Release; neither is evidence that npm contents, provenance, signatures, authentication mode, or DSH integration work.

## Rollback

If publication is defective:

1. Stop promotion and announce the affected version.
2. Deprecate the exact package version instead of deleting history:

```bash
npm deprecate @softspark/dsh-codex@X.Y.Z "Do not use: REASON"
```

3. Fix forward with a new version and changelog entry, through the same script.
4. Remove or replace a GitHub Release only after preserving the audit trail.
5. Never reuse or move the published tag.
