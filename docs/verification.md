# Verification evidence — dev.2

[Home](../README.md) · [Implementation status](implementation-status.md) · [Release gates](roadmap.md)

## Baselines and scope

September 12, 2026. Local environment: Linux, Node 22.16.0, TypeScript 5.8.3. Inspected plugin base: `13d1497b91aa990d1707ee3a1c164b49a327acfb`; merged Zenith reader: `2d56ecc3abe77f560d9c58bee14370b0789f386a`.

Source was retrieved through the authenticated GitHub connection and reconstructed in the execution workspace. Direct Git clone/registry DNS access was unavailable. Unchanged files are preserved when creating the PR tree; no claim of a successful network clone is made. The execution environment restarted after local verification and during upload; source changes were preserved in GitHub objects. Generated packages must be synchronized from the same source before this PR is complete.

## Local results

`npm run verify` and `npm run release:prepare` both passed locally before the environment restart. Earlier development runs passed 72, 87, 88 and then 92 tests as coverage was added; these are successive suites, not additive totals.

| Command/check | Evidence |
| --- | --- |
| `npm run verify` | Passed: typecheck, build, 92 tests, syntax/integrity/layout/link checks |
| `npm run release:prepare` | Passed: verification plus two local review archives and manifest/checksums |
| Repeated build | All 34 generated files unchanged |
| `npm run typecheck` | Passed: strict transport client TypeScript only |
| `npm run build` | Passed: compiled client and both generated package layouts |
| `npm test` | 92 passed, zero failed/cancelled/skipped on local Linux |
| Copied-package tests | Actual Node stdio subprocesses and authenticated HTTP fixtures, not native agent clients |
| Setup/profile tests | Private permissions, non-overwrite, bounded reads, ambiguity refusal and local token rotation/deletion |
| Archive tests | npm packs both packages offline; hidden manifests and every inventory hash checked; repeated archives byte-identical locally |

## What fixtures prove—and do not

Tests exercise destination/scope immutability, request snapshotting, no write forwarding, protocol/result validation, initialization races, acknowledgement failure, duplicate IDs, cancellation, EOF/shutdown, byte limits, deadlines, credential handling and diagnostic minimization. The smoke-script fixture test uses real HTTP and copied doctor subprocesses but explicitly labels its server as a fixture.

These tests do not verify a running Zenith application, backend membership/tenant isolation, real providers, file-store/Postgres parity, native manifests or model skill selection. Malicious prose remains inert in a transport fixture; that is not a model-level prompt-injection evaluation.

## Environment and release blockers

No Codex/Claude Code binaries or parallel-subagent facility were available. Both package tracks were implemented sequentially from shared sources. No live Zenith or native-client run is claimed. Remote OAuth, a maintained MCP SDK, writes/receipts/approvals, replay-safe backend operations and source publishing are not implemented in this increment.

The pinned TypeScript compiler was already installed globally and linked into ignored local node_modules. A fresh-directory `npm ci --ignore-scripts --fetch-retries=0 --fetch-timeout=5000` with an empty cache failed with `EAI_AGAIN` resolving registry.npmjs.org. CI is configured for clean installation and Linux/macOS/Windows verification; configuration alone is not a passing CI result. POSIX private-file tests explicitly skip on Windows because ACL storage is unimplemented; environment-only transport/package tests still run.

Reproduce with `npm ci --ignore-scripts && npm run verify`. Repeat the build and require unchanged generated inventories. `npm run release:prepare` creates local review artifacts only. Run `ZENITH_LIVE_TEST=1 npm run test:live` with a real isolated Zenith and scoped credential, then separately exercise actual native clients and record their versions. Missing prerequisites are blockers, never fabricated passes.
