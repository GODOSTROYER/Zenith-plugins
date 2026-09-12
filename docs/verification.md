# Verification evidence — dev.2

[Home](../README.md) · [Implementation status](implementation-status.md) · [Release gates](roadmap.md)

## Baselines

September 12, 2026 (UTC). Plugin base: `13d1497b91aa990d1707ee3a1c164b49a327acfb`; merged Zenith reader: `2d56ecc3abe77f560d9c58bee14370b0789f386a`. Runtime: Node 22.16.0, pinned TypeScript 5.8.3.

## Verified locally

| Command/check | Result |
| --- | --- |
| `npm run verify` | Passed: strict client typecheck, generation, **96 tests**, source syntax, complete package integrity, layouts and local documentation links |
| `npm run release:prepare` | Passed: verification plus two local review archives and SHA-256 checksums; nothing published |
| Repeated build/archive tests | Generated inventories unchanged; both npm archives byte-identical across repeated local packing |
| Copied-package tests | Real Node stdio subprocesses and authenticated HTTP fixtures in paths with spaces, outside the source checkout |
| Setup/diagnostic tests | Private permissions, refusal to overwrite, bounded reads, ambiguity refusal, scope checks and token rotation/deletion |

The final local Linux suite has 96 passes, zero failures, cancellations or skips. Test counts from intermediate runs are not additive.

## GitHub CI

The workflow performs a clean `npm ci --ignore-scripts`, full verification and a clean-generated-diff check on Linux, macOS and Windows. Actions are pinned to commit SHAs; checkout credentials are not persisted. The [PR checks](https://github.com/GODOSTROYER/Zenith-plugins/pull/2/checks) record the exact final-head result; do not infer it from this document or an earlier run.

Clean installations succeeded on all three systems. Linux and macOS completed the full verification and reproducibility gates during development. CI found and reproduced a macOS symlinked-path launcher bug, now covered by a regression test. It also demonstrated that Windows Server 2025 with Node 22.16 can report device ID zero from path stat while the opened file reports a nonzero device. The reader now gives an explicit `file_identity_unverified` refusal on that runtime rather than treating zero as a wildcard. Windows users should supply scope IDs and credentials explicitly through the environment. Private-file ACL validation remains unimplemented and fails closed.

Seven POSIX permission/symlink tests are explicitly skipped on Windows; these skips are not passes. Environment-based transport and both copied-package paths still run. Identity tests exercise safe refusal when the runtime cannot supply a verifiable identity.

## Scope of evidence

Tests cover request/destination/scope immutability, no write forwarding, protocol/result validation, initialization races, acknowledgement failure, duplicate IDs, cancellation, EOF/shutdown, byte limits, deadlines, credential handling and diagnostic minimization. Archive tests inspect hidden manifests and every packaged file hash. Hashes are not publisher signatures.

**Not verified:** a running Zenith application, backend membership/tenant isolation, real providers, file-store/Postgres parity, actual Codex/Claude binaries, native skill invocation or model-level prompt-injection resistance. The smoke-script fixture uses HTTP and copied doctor subprocesses, but it is still a fixture. Inert transport of malicious prose is not proof of safe model behavior.

No subagent facility was available; both client tracks were implemented sequentially from shared sources. Remote OAuth, maintained MCP SDK migration, writes/receipts/approvals, restart-safe backend operations and source publishing are not implemented in this increment.

## Reproduce and continue

```bash
npm ci --ignore-scripts
npm run verify
npm run release:prepare
```

Local registry DNS was unavailable; local runs used the already-installed pinned compiler. GitHub CI supplies separate clean-install evidence. A workspace reset during upload was recovered from the authenticated CI artifact, then packages were regenerated from the preserved source; no failed clone or missing test was reported as successful.

Run `ZENITH_LIVE_TEST=1 npm run test:live` with a real isolated Zenith and scoped credential, then separately exercise the actual native clients and record versions and negotiated protocol. Missing prerequisites are blockers, never fabricated passes. No packages, services or infrastructure were published or deployed.
