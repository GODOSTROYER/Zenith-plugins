# Remaining scope and decisions

[Home](../README.md) · [Implemented control surface](control-v2.md)

## Implemented in 0.2.0-dev.1 and its backend companion

- [x] Maintained SDK-backed standalone connector and two self-contained plugin packages.
- [x] Exact persisted proposals, browser approvals, one-time dispatch, operation events and same-user cross-client handoff.
- [x] Curated edits, manifest/Compose import, deploy, rollback and saved-revision promotion.
- [x] App creation, digest-bound binary source upload, supported publishing and code rollback.
- [x] Remote OAuth resource verification, live integration grants/revocation, native remote configuration and provider-owned OAuth flow.
- [x] Named POSIX connection profiles, Windows CurrentUser DPAPI credential storage with private ACL checks, and macOS Keychain credential storage using stdin-only secret input.
- [x] Scoped logs, revision comparison, incident bundles, source commit/PR provenance, eleven skills and two Claude evidence reviewers.
- [x] Versioned contract snapshot/parity checks, strict v2 runtime/client types, runtime dependency notices and reproducible packages.
- [x] Manually authorized review-artifact signing/SBOM workflow and documented release/compatibility process.

## Still not implemented; not disguised as testing

- [ ] Coordinated PostgreSQL write journal/application transactions and multi-process execution. Current write topology intentionally refuses them.
- [ ] Distributed quotas/rate limiting, durable notification/webhook outbox and aggregate service metrics/alert delivery.
- [ ] GitHub PR plan-comment/check automation. Source provenance is recorded, but no GitHub access is requested and no comment bot exists.
- [ ] A bundled OAuth authorization service or bridge-managed browser-login/refresh workflow. Use your maintained provider/native client's OAuth flow; the resource server is implemented.
- [ ] Private named-profile ACL storage on Windows. Windows DPAPI credential storage is separate and implemented.
- [ ] Full strict type coverage of the retained legacy v1 JavaScript files. The new v2 client/runtime are strictly checked.
- [ ] Public directory submission, release publication and a chosen project license; these require owner decisions/authorization.

## Deployment/acceptance, not missing code

- [ ] Configure a real issuer/client/redirects/resource scopes and existing Zenith user mapping.
- [ ] Native Codex and Claude Code discovery, login, approval UI and provider acceptance on the selected platform.
- [ ] Set backup/retention/TLS/network policy for the long-lived supported backend.
- [ ] Invoke the manual attested-artifact workflow after review, then verify its signatures before a separately authorized publication.

Do not remove topology/authentication guards to check off a feature. No claim is made that every optional roadmap suggestion or production topology is finished.
