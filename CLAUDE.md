---
output-mode: concise
---

# dsh-codex

## Project

`@softspark/dsh-codex` is a strict ESM TypeScript provider plugin for DeepSeek Harness. The target provider ID is `codex`. It delegates execution and authentication to the local `codex app-server` process over JSON-RPC on stdio.

Version `0.1.0` is unpublished. Do not describe the adapter as working until the composition, packaging, and real-client smoke tests pass.

## Commands

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

## Architecture rules

- Codex owns authentication and credential storage.
- Never read or write Codex auth files, tokens, cookies, or browser callbacks.
- Never add custom OAuth or an OpenAI API-key fallback.
- Never call the OpenAI Responses API or another OpenAI HTTP endpoint directly.
- Start `codex app-server` directly without a shell.
- Validate every JSON-RPC boundary and redact errors before exposure.
- Do not add telemetry, analytics, crash upload, or remote logging.
- Keep `@deepseek-ai/cordis` and `@deepseek-ai/dsh-llm` as peer dependencies.
- Treat experimental dynamic tools as untrusted requests with explicit limits.

## Generated protocol schema

Files explicitly marked as generated from the Codex app-server schema are protected. Do not hand-edit them. Regenerate from the pinned Codex CLI version, review the diff, and update protocol tests in the same change.

## TypeScript rules

- Node.js 22.19 or newer, `type: module`, and `NodeNext` resolution.
- Strict mode, no `any`, no non-null assertions in production code.
- Use `unknown` plus runtime guards at protocol boundaries.
- Use `readonly` interfaces and explicit return types for exported functions.
- Use `node:` imports and `.js` extensions in relative imports.
- No lifecycle scripts, shell execution, hidden network clients, or secrets.

## Repository rules

- The KB is the source of truth once the matching document exists.
- Behavior changes require unit tests, integration tests, and documentation.
- Conventional Commits only: `feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`.
- Never edit generated `lib/`, local `.agents/`, `.claude/`, `.codex/`, or user `.idea/`.
- Never commit credentials, Codex state, personal configuration, logs, tarballs, or SARIF output.
- Green verification gates define completion.
