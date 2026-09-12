# Verification — control v2

[Home](../README.md) · [Remaining scope](roadmap.md)

The implementation extends plugin PR #2 (`0a2954e`) and Zenith's merged v1 reader (`2d56ecc`). V2 source includes strict client/runtime TypeScript, SDK protocol fixtures, private-profile/source tests, generated package parity, contract inventory and reproducible archives. See the PR's final checks for exact commit-specific counts; this document is not a passing-run certificate.

```bash
npm ci --ignore-scripts
npm run verify
npm run contracts:check -- --backend /absolute/path/to/zenith
npm run release:prepare
```

The SDK integration test starts each copied installed package outside the checkout, connects the maintained MCP client, and calls tools against an authenticated HTTP fixture. It proves packaged Node/SDK interoperability, not actual Codex/Claude skill discovery, UI review, cloud providers or a configured OAuth provider. DPAPI tests execute only on Windows; POSIX profile tests intentionally skip there. Skips are not passes.

Backend focused evidence includes persistent-journal/concurrency/restart tests, coordinator authorization/plan/approval tests, JWT claim/scope/revocation tests and binary-source boundary tests. The backend source checkpoint also passed a clean install, whole-application TypeScript compilation and the original reader contract tests in GitHub Actions. Real action/provider/store acceptance remains your separate validation work.

The local execution environment has no registry/GitHub DNS. Existing pinned tooling was obtained from an authenticated CI artifact; clean dependency lock resolution/installation and generated output are verified again in GitHub. Source transfers use exact checksum-verified, allowlisted patches on feature branches; temporary assembly workflows remove themselves. Nothing is force-pushed, merged or published by those transfers.

No independent subagent or native coding-client run is claimed. Manual release signing is implemented but not invoked; configured workflows and checksum inventories do not establish that an artifact has already been signed.
