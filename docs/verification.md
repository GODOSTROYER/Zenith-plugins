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

The local execution environment has no registry/GitHub DNS. Existing pinned tooling was obtained from an authenticated CI artifact; clean dependency lock resolution/installation and generated output are verified again in GitHub. Source transfers use exact checksum-verified, allowlisted patches on feature branches; temporary assembly workflows have been removed. Nothing is force-pushed, merged or published by those transfers.

No independent subagent or native coding-client run is claimed. Manual release signing is implemented but not invoked; configured workflows and checksum inventories do not establish that an artifact has already been signed.

## Integration follow-up

Local Linux checks with Node 22.16.0 pass: `npm run verify` (127 tests: 126 passed and one Windows-only test skipped), `npm run contracts:check -- --backend /mnt/data/work/zenith` (actual companion schema parity), and `npm run release:prepare` (both reproducible local archives). Read [PR #4 checks](https://github.com/GODOSTROYER/Zenith-plugins/pull/4/checks) for the final-head cross-platform result rather than treating an earlier run as current evidence.

The Windows-specific native vault test passed in [assembly run 34725765364](https://github.com/GODOSTROYER/Zenith-plugins/actions/runs/34725765364) on source `4998bf9`. That run also regenerated and committed the bundles after full Linux verification. The generated control bundle matches the independently rebuilt local blob `1cc10d12b90d279f041bcb0f1ba4a520b7a9b60c`.

## Browser link coverage (0.3.0-dev.1)

`tests/control-link.test.mjs` drives the start/poll state machine against a stub fetch with an injected clock: `authorization_pending` loops at the server interval, `slow_down` raises it and the raised interval is honoured, a `slow_down` answer cannot lower it, `access_denied` and `expired_token` are terminal, the expiry deadline and the hard 200-request cap each end the loop, a hostile error body cannot rewrite the terminal or smuggle an unbounded message, and the device code appears in no printed line, no request URL and no diagnostic record. `tests/control-login.test.mjs` and `tests/control-logout.test.mjs` split by platform exactly as the DPAPI/profile tests already do: the POSIX halves assert the 0600 credential file, the profile contents, the granted-scope `allowWrites` and the refusal to overwrite, while the Windows halves assert the DPAPI vault, the absent profile, the printed environment block and create-only storage. A skipped half is not evidence for the other platform. `tests/control-status.test.mjs` asserts the reported shape, the honest nulls when the backend has not returned a field, and that "not linked" exits 0 while an unconfirmed scope exits 1.

These run against a stub fetch, so they prove the connector's half of the wire protocol and its storage rules. They are not evidence that a Zenith instance implements the link endpoints, and they do not exercise a browser, a real approval page or a real credential.

Regression coverage includes token-free native OAuth setup, no access to configured token sources during configuration generation, explicit HTTPS/scope requirements, native Windows JSON/Unicode input, short-path alias validation, device/stream/traversal refusal, and non-secret native error stages. The Windows suite exercises actual DPAPI encryption/decryption, create-only behavior and private security descriptors; its success is separate from a skipped Linux test.
