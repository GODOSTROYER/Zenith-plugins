# Remaining work and release gates

[Home](../README.md) · [Verification](verification.md) · [Checkpoint](implementation-status.md)

This is a continuation checklist, not an assertion that unfinished capabilities exist.

## 1. Validate the merged development reader

Use Zenith master containing `2d56ecc3abe77f560d9c58bee14370b0789f386a`. Run full application typecheck/lint/tests/build and exercise real file-store/Postgres reads, middleware boundaries, revoked membership, foreign project/environment/deployment IDs, stored findings, redacted exports and provider refusals. Prove inspection starts no deploy/alert side effects.

Run the opt-in live command against that real instance, then validate actual Codex and Claude binaries: root interpolation, environment inheritance, skill discovery, tool schemas, inspect/preview outcomes and prompt-injection scenarios. Record exact versions, OS and negotiated protocol; copied Node processes do not prove these behaviors. Complete clean npm installation evidence in CI.

## 2. Replace the limited protocol and add remote authorization

Migrate to a maintained MCP SDK while preserving the backend contract and bounded behavior. Validate negotiation, cancellation, sessions and streaming as applicable. Add maintained OAuth authorization with consent/PKCE and strict resource audience, issuer, expiry and scopes. Operator credentials and private profiles are not OAuth substitutes. Implement/review Windows ACL storage before enabling private files there.

## 3. Authoritative execution

Implement durable expiring plan receipts and operations in Zenith, bound to identity, scope, inputs and state/policy versions. Atomically claim and validate, require trusted approval, protect replay and reconcile after restart. Test simultaneous agents and state/permission changes between review and execution before exposing curated edit/import/deploy/rollback tools. Never add a catch-all action shortcut or admin privilege changes.

## 4. Supported publishing

Reuse Zenith source validation, pinned recipe, app-owner grants and durable publish jobs. Package explicitly selected local source, reject traversal/symlinks/credentials and transfer bytes outside model context. Test failed candidates, healthy-release retention, probe cleanup and rollback. Do not promise arbitrary backend/Next.js publishing beyond the restricted React/Vite source contract.

## 5. Release and lifecycle

Local deterministic review archives and integrity checks exist. Still required: actual supported-client/OS evidence, maintainable compatibility/deprecation policy, pinned CI action revisions, private security review, license decision and explicit publication authorization. Checksums are not signatures. Do not mark the complete product release-ready based on unit-test counts. No workflow publishes packages, exposes a public endpoint or deploys production infrastructure.
