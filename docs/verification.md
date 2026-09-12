# Verification evidence

[Home](../README.md) · [Architecture](architecture.md) · [Release gates](roadmap.md)

## Evidence date and baseline

Recorded September 12, 2026. Local runtime: Node 22.16.0; TypeScript 5.8.3. Zenith source baseline: `70d9c4a610b96f3d45bed0d85bd4155bbbf295f7`. These are development results, not a release certificate.

The earlier 22-byte ZIP contained no entries. The earlier claim of an implementation and 71 passing tests cannot be substantiated and is not used as evidence. This draft records only inspected files and commands actually run in the current workspace.

## Local distribution checks

| Command | Result | What it proves |
| --- | --- | --- |
| `npm run typecheck` | Passed | Strict TypeScript checks for the transport client only |
| `npm run build` | Passed | Client compilation and two generated package layouts |
| `npm test` | 29 passed; 0 failed; 0 skipped | Transport/unit assertions and two copied-package stdio/HTTP fixture flows |
| `npm run check` | Passed | Manifest/runtime layout, generated equality and local Markdown link targets |

The tests exercise origin validation, association restrictions, request framing, scope headers, no write forwarding, tool filtering, bounded responses, protocol refusals, private credential files, and package paths containing spaces. Both package smoke tests start a real Node stdio process from a copied installation outside the checkout and call an authenticated HTTP **fixture**.

They do not launch Codex or Claude Code, evaluate an actual model's skill selection, or call a running Zenith application. A passing fixture does not prove the companion endpoint, provider adapter or database behavior.

## Dependency installation limitation

`npm install --package-lock-only --ignore-scripts --fetch-retries=0 --fetch-timeout=10000` failed with `EAI_AGAIN` reaching the npm registry in the shell environment. Verification used the already-installed TypeScript compiler of exactly the pinned version, linked into ignored local node_modules.

The lockfile's TypeScript version, tarball and integrity were taken from the official npm registry metadata for 5.8.3. A clean online `npm ci` was **not run successfully** here. CI is configured to do that; its future or remote outcome is not claimed in this document.

## Not verified / not implemented

Full Zenith typecheck, lint, production build and tests; a real local inspect/preview workflow; Postgres parity; native Codex/Claude Code manifest validation and invocation; macOS/Windows behavior; browser approvals; durable write receipts, replay/restart/concurrency safety for writes; unsafe archive handling; hosted publishing; remote OAuth audience/issuer/expiry checks; public distribution.

No actual parallel subagent facility was available for this increment. The client tracks were implemented sequentially from shared sources. This is disclosed instead of attributing results to nonexistent agents.

## Reproduce and expand

On a network-enabled clean checkout, run `npm ci --ignore-scripts` followed by `npm run verify`. Run the build a second time and require no generated diff. Review and test the companion independently on the recorded Zenith base. Capture actual client versions, negotiated protocol revisions, OS and provider evidence before changing any compatibility label.

Do not convert this PR from draft based only on the fixture count. The original end-to-end acceptance criteria remain open.
