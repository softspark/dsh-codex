---
title: "dsh-codex Common Issues"
category: troubleshooting
service: dsh-codex
tags: [troubleshooting, node, codex, authentication, dsh]
created: "2026-08-26"
last_updated: "2026-08-26"
description: "Diagnoses local Node, Codex authentication, app-server protocol, timeout, sandbox, and DSH selector failures."
---

# dsh-codex Common Issues

## Node 11 runs despite Node 22 being installed

**Symptoms:** A script reports unsupported syntax, ESM errors, or the wrong Node engine. `node --version` prints `v11.x`.

**Root cause:** The shebang resolves the first `node` on PATH, often an old `/usr/local/bin/node`.

**Resolution:**

```bash
command -v node
which -a node
env PATH="/path/to/node-v22/bin:/usr/local/bin:/usr/bin:/bin" node --version
env PATH="/path/to/node-v22/bin:/usr/local/bin:/usr/bin:/bin" npm run typecheck
```

**Prevention:** Put the supported Node directory before system paths in the shell profile and keep CI on Node 22.19.0.

## Codex authentication mode is not ChatGPT

**Symptoms:** `codex login status` reports an API key, or usage is billed through the API account.

**Root cause:** Codex supports ChatGPT subscription access and API-key usage-based access. The active cached login selects the mode.

**Resolution:**

```bash
codex logout
codex login
codex login status
```

Complete the ChatGPT browser flow. Do not copy `auth.json` into the plugin. See [OpenAI Codex authentication](https://learn.chatgpt.com/docs/auth).

**Prevention:** Check auth mode in setup and release smoke tests.

## Codex binary is not found

**Symptoms:** Spawn fails or `command -v codex` returns no path.

**Root cause:** Codex CLI is absent from the environment inherited by DSH, or GUI-launched DSH has a different PATH.

**Resolution:**

```bash
command -v codex
codex --version
```

Start DSH from a shell with the verified PATH. Do not configure a shell command or add quoting to the executable field.

**Prevention:** Record the resolved Codex path and version in the compatibility test.

## App-server protocol mismatch

**Symptoms:** Initialization fails, an event is rejected, or model fields no longer validate after a Codex update.

**Root cause:** App-server schemas are specific to the Codex CLI version that generated them.

**Resolution:**

```bash
codex --version
codex app-server generate-ts --out /tmp/codex-schema
```

Compare the generated schema with the pinned release fixture. Update validation, tests, and compatibility documentation together. Do not hand-edit generated bindings. See [OpenAI Codex App Server](https://learn.chatgpt.com/docs/app-server).

**Prevention:** Pin a tested Codex version for each release and run wire-level fixtures on upgrade.

## Request or shutdown timeout

**Symptoms:** A request fails after 30 seconds, cancellation does not complete, or shutdown reaches forced termination.

**Root cause:** Codex is waiting for approval, model work, a tool, or process I/O. It can also indicate a hung or incompatible app server.

**Resolution:** Check sanitized stderr, Codex approval UI, and the active sandbox. Reproduce with a minimal text turn. Increase a timeout only after identifying the blocked operation.

**Prevention:** Keep request, tool, and shutdown timeouts explicit. Test abort and hung-process paths.

## Sandbox or approval behavior differs from DSH

**Symptoms:** Codex requests approval that DSH did not display, or DSH policy appears more permissive than Codex.

**Root cause:** DSH and Codex have separate permission systems. One system's approval does not authorize the other.

**Resolution:** Stop the turn. Use a stable, tested Codex sandbox and approval policy. Do not enable experimental tool bridging to bypass the mismatch.

**Prevention:** Maintain an explicit mapping and composition tests for every supported policy.

## Codex models do not appear in the DSH selector

**Symptoms:** The provider is loaded but no Codex model is selectable, or DSH reports that provider `codex` is not configured.

**Root cause:** The Cordis patch or DSH adapter is missing, model discovery failed, hidden models were filtered, or the current DSH UI cannot consume a dynamic catalog.

**Resolution:**

1. Confirm the installed artifact contains `cordis.patch.yml`.
2. Confirm provider ID `codex` loaded in the isolated DSH profile.
3. Run `codex login status` and verify ChatGPT mode.
4. Check sanitized `model/list` validation errors.
5. Use an explicit tested model ID only if the release notes document that workaround.

**Prevention:** Run the model-selector check in the real-client smoke test for every supported DSH version.
