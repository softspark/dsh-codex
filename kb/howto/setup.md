---
title: "Set Up dsh-codex from Source"
category: howto
service: dsh-codex
tags: [setup, source, codex, dsh, authentication]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Builds and checks dsh-codex against a local ChatGPT-authenticated Codex CLI."
---

# Set Up dsh-codex from Source

## Prerequisites

- Node.js 22.19.0 or newer.
- npm with lockfile support.
- A local Codex CLI installation.
- A Codex CLI session signed in with ChatGPT.
- A disposable DSH profile for later composition testing.
- Git.

The adapter and provider patch are complete for the documented scope. This guide verifies the source and a local package artifact independently of the registry release.

## Steps

### 1. Clone the repository

```bash
git clone https://github.com/softspark/dsh-codex.git
cd dsh-codex
```

### 2. Select Node.js 22

```bash
node --version
npm --version
```

If macOS resolves an old system Node, prepend the Node 22 binary directory:

```bash
env PATH="/path/to/node-v22/bin:/usr/local/bin:/usr/bin:/bin" node --version
```

The version must be at least `v22.19.0`.

### 3. Verify Codex and ChatGPT authentication

```bash
command -v codex
codex --version
codex login status
codex app-server --help
```

The login status must report ChatGPT for subscription-backed use. If it reports an API key, change the login outside DSH:

```bash
codex logout
codex login
```

OpenAI documents `codex login` as the ChatGPT browser flow and `codex login status` as the authentication check. See [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth).

### 4. Install dependencies without lifecycle scripts

```bash
npm ci --ignore-scripts
```

Do not run `npm install` to rewrite the reviewed lockfile.

### 5. Run source gates

```bash
npm run verify
npm run typecheck
npm run lint
npm run test:coverage
npm run build
npm run audit
npm run audit:permissions
npm run package:check
```

### 6. Inspect the local package artifact

```bash
npm pack --dry-run --ignore-scripts
```

The artifact must contain `lib/`, `cordis.patch.yml`, `README.md`, `CHANGELOG.md`, `LICENSE`, and `NOTICE`. If the provider entry or patch is absent, stop.

Create the tarball only for a disposable DSH profile test:

```bash
npm pack --ignore-scripts
dsh plugin --profile <disposable-profile> add file:./softspark-dsh-codex-1.0.0.tgz --save-exact
```

Start that profile with no OpenAI API key in the environment and confirm provider `codex` appears. Do not modify the real Codex credential store.

## Verification

This setup is successful when:

- Node and Codex commands resolve;
- Codex reports ChatGPT authentication;
- dependency installation runs no lifecycle scripts;
- typecheck, lint, tests, build, audit, and package dry run pass;
- the disposable DSH profile loads provider `codex` from the local tarball.

## Rollback

The steps above modify only the disposable DSH profile, never a regular profile. Remove the disposable clone or keep it for development, then discard the isolated `DSH_HOME` and restore the previous `DSH_HOME` value. Do not alter the real Codex credential store.

## Troubleshooting

See [Common issues](../troubleshooting/common-issues.md).
