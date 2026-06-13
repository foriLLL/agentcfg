# Testing Capability Design

## Purpose

This document is the testing contract for agentcfg development. It turns the current verification lanes into a repeatable TDD workflow so changes to existing features and newly designed features can be proven before they are shipped.

Every behavior change starts with a scenario, a failing assertion, the smallest implementation that makes the assertion pass, and a real-surface check. The current suite provides unit, fixtures, API, server, CLI, GUI, and Docker validation.

## Current Verification Lanes

| Lane | Binary pass condition | Real surface proved |
| --- | --- | --- |
| `npm run typecheck` | TypeScript exits 0 with no type errors. | Production, test, and web-facing TypeScript contracts. |
| `npm run build` | `tsc -p tsconfig.json` exits 0 and emits `dist/`. | CLI, API, server, adapters, and compiled tests. |
| `npm run build:web` | Web TypeScript and Vite build exit 0 and emit `web/dist/`. | Browser bundle and static assets served by `agentcfg web`. |
| `npm run test:unit` | All `dist/test/unit/*.test.js` tests pass. | Schema, adapters, native parsing, masking, diffing, backups, docs contracts. |
| `npm run test:fixtures` | All fixture golden outputs match. | Codex, OpenCode, and OpenClaw rendered config shapes. |
| `npm run test:api` | Runtime API tests pass with expected response bodies and state files. | State, Gist operations, remote save/load, diff/apply planning, config editor, model discovery. |
| `npm run test:server` | HTTP server tests pass with expected status codes and JSON envelopes. | Local Web API routing, static serving, token secrecy, provider API key visibility. |
| `npm run test:cli` | CLI tests pass with expected stdout/stderr and file snapshots. | `init`, `pull`, `diff`, `apply`, `web`, all-agents, dry-run, rollback, idempotency. |
| `npm run test:gui` | Browser flow test passes through init, pull, diff, dry-run, preview, and apply. | Real Web UI behavior through Chrome/CDP against a running server. |
| `npm run test:docker:opencode` | Docker validation passes or documents an environment skip. | Generated OpenCode config parses in the upstream container without provider network access. |
| `npm test` | Build and every test lane above pass in order. | Full repository regression gate. |

## TDD Scenario Contract

Before editing production code, define at least three scenarios unless the change is a pure documentation or formatting change:

- happy path: the intended user-visible behavior returns the exact status, file content, CLI output, or UI state expected.
- edge or malformed path: empty, invalid, missing, conflicting, read-only, or provider-error input fails closed with the expected message and no unintended writes.
- adjacent-surface regression: related CLI, API, server, GUI, adapter, state, or fixture behavior remains unchanged.

Each scenario must name a binary pass condition, the real surface that proves it, and the test file plus test id that protects it. The implementation sequence is `RED -> GREEN -> SURFACE`: first capture the failing assertion, then make the smallest code change, then exercise the real CLI/API/browser/Docker/config surface.

The RED artifact must fail for the intended reason. The GREEN artifact must show the same test passing. The SURFACE artifact must use the user-facing path, such as a literal CLI command, `curl` request, browser/CDP flow, Docker validation, or config-file load.

## Feature Coverage Matrix

| Feature area | Existing tests | Add before new work |
| --- | --- | --- |
| Canonical schema and serialization | `test/unit/schema.test.ts`, canonical fixtures. | Add invalid fixtures for every new field, boundary, and cross-reference rule. |
| Codex adapter | `test/unit/codex-adapter.test.ts`, `test/fixtures/fixtures.test.ts`, CLI all-agent flows. | Add adapter unit tests and fixture goldens before changing native TOML or env output. |
| OpenCode adapter | `test/unit/opencode.test.ts`, OpenCode fixtures, Docker validation. | Add unit, fixture, and Docker-shape assertions before changing provider/model rendering. |
| OpenClaw adapter | `test/unit/openclaw.test.ts`, OpenClaw fixtures. | Add JSON5 fixture goldens before changing primary/provider config rendering. |
| Native config IO | `test/unit/native-io.test.ts`. | Add malformed and preservation cases before supporting new native formats. |
| State, Gist, and token handling | `test/api/runtime.test.ts`, `test/server/web-server.test.ts`, CLI pull/e2e tests. | Add API and server tests before changing state shape, Gist metadata, or token storage. |
| Diff/apply and atomic writes | CLI diff/apply/e2e tests, backup tests, atomic-write tests. | Add dry-run, apply, idempotency, all-or-nothing, and rollback cases before changing writes. |
| Web UI flow | `test/gui/web-flow.test.ts`, server tests, web build. | Add GUI assertions before changing visible workflow, confirmations, previews, or forms. |
| Model discovery | Runtime API and server tests. | Add frontend API/UI tests before exposing discovery controls in the browser. |
| Planned adapters or providers | Existing adapter test pattern plus fixture goldens. | Start with schema fixture, adapter unit test, native fixture, CLI diff/apply scenario, then real surface. |

Cross-surface security gates stay explicit: provider API keys remain visible in trusted local Web/API/state surfaces where the user must see the final written value; GitHub tokens never appear in runtime, server, GUI, or state responses. Tests for Codex, OpenCode, OpenClaw, model discovery, atomic write, and rollback must preserve that split.

## Change Workflow

1. Pick the smallest feature area and write the scenario contract.
2. Add or update the most specific test first and run it to capture RED with the failing assertion.
3. Implement the smallest production change needed for GREEN.
4. Run the focused lane that owns the behavior.
5. Exercise the real surface: CLI command, `curl` endpoint, browser flow, Docker command, or config parse/load.
6. Run adjacent lanes from the coverage matrix.
7. Run `npm run typecheck`, `npm run build`, and `npm test` before declaring completion when the change touches production behavior.

Pure documentation changes still need a docs contract when the document is normative. Formatting-only or comment-only changes can skip new tests if the final note says why there is no behavior delta.

## Manual QA Surfaces

Use manual QA to prove behavior that typechecking cannot see:

- CLI changes: run the exact `agentcfg` command and capture stdout, stderr, exit code, and affected files.
- API changes: call the endpoint with `curl` or the runtime helper and assert status code plus schema-matching body.
- Web changes: drive the built UI through the browser/CDP flow and verify visible state.
- Config handling changes: load a real native config file and compare parsed or rendered shape.
- Docker/OpenCode changes: run `npm run test:docker:opencode` and confirm the generated config parses in the container or records an environment skip.
- Write-path changes: verify backup creation, atomic write result, idempotency, and rollback behavior.

Clean up every QA resource created for a scenario, including servers, browser sessions, temp directories, fixture files, and Docker containers.
