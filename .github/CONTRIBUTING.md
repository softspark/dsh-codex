# Contributing

## Workflow

1. Fork the repository and branch from `main`.
2. Use `feat/`, `fix/`, `refactor/`, `docs/`, or `test/` prefixes.
3. Use Conventional Commits with one logical change per commit.
4. Add behavior-focused tests and update affected documentation.
5. Run every local gate before opening a pull request.

## Local Gates

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

## Engineering Rules

- Node.js 22.19 or newer and strict ESM TypeScript.
- No `any`, lifecycle scripts, telemetry, API-key fallback, or credential storage.
- Codex owns authentication. Never read or copy its token files.
- Launch the Codex subprocess directly, without a shell.
- Validate all DSH and Codex protocol data at runtime.
- Keep Cordis and DSH extension seams as peer dependencies.
- Add Apache-2.0 SPDX headers to source and tooling files.

## Security

Do not open a public issue for a vulnerability. Follow
[SECURITY.md](../SECURITY.md) and email biuro@softspark.eu.
