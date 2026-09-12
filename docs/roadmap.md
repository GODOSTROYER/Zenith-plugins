# Remaining work and release gates

[Home](../README.md) · [Verification](verification.md)

This file is a continuation checklist, not a promise that unfinished capabilities exist. Keep the draft unmerged until its scope and residual risks have been reviewed.

## Gate 1 — validate the development reader

Apply the companion on the inspected Zenith base, run the full application's typecheck/lint/tests/build and exercise actual file-store and Postgres reads. Verify the exact middleware exemption, revoked membership, foreign project/environment/deployment IDs, stored findings filtering, redacted exports and provider failures. Prove that inspection starts no deployment or alert side effects.

Reproduce npm installation from the lockfile in CI. Validate both packages through actual client binaries, not only a copied Node process. Confirm root-variable interpolation, environment inheritance, tool discovery, skill naming and read/preview outcomes. Record exact versions and OS coverage.

## Gate 2 — replace the limited protocol layer

Use a maintained MCP SDK, retain the shared backend tool contract, and validate protocol/version negotiation, cancellation, sessions and bounded streaming as applicable. Add a maintained OAuth authorization provider for remote access, PKCE/consent and strict resource audience, issuer, expiry and scope checks. Operator tokens are not a remote OAuth substitute.

## Gate 3 — authoritative execution

Implement durable, expiring plan receipts and operations in Zenith, not in plugin storage. Bind them to identity, scope, input and state/policy versions. Add atomic claim and validation, trusted human approval, replay protection and restart reconciliation. Test simultaneous agents and changes between preview and execution before enabling any write tool.

Expose a curated mutation/import/deploy/rollback surface only after these guarantees hold. Do not add a catch-all action tool as a shortcut. Keep privilege administration and raw secret operations out of the initial surface.

## Gate 4 — supported hosted publishing

Reuse Zenith's source validation, pinned recipe, app-owner grants and durable publishing jobs. Validate selected local files, reject traversal/symlinks/credentials and transfer archive bytes outside model context. Test failed candidate releases, disposable probe data and rollback compatibility. Do not promise arbitrary backend or Next.js publishing when the source contract supports a restricted React/Vite frontend.

## Gate 5 — release and lifecycle

Add versioned release automation, documented upgrade/deprecation policy, supported-platform CI and native-client task evaluations. Pin CI action revisions after verification. Resolve the project's licensing decision with its owner. Require reproducible bundles, private security review and explicit publication authorization. No workflow in this draft publishes a package, creates a public endpoint or deploys production infrastructure.
