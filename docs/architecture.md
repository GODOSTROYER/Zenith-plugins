# Architecture

[Home](../README.md) · [Security](security.md) · [Verification](verification.md)

## Ownership is the first boundary

`Zenith-plugins` owns a typed transport client, a local stdio process, generated packages and shared skills. `zenith` owns the authenticated endpoint and the application it reads. The bridge neither imports application internals nor opens application storage. This keeps client changes independent of the persistence implementation and prevents a second writer from appearing beside a local Zenith process.

The companion branch adds `src/lib/agent-access/`, an exact `/api/agent/v1/mcp` route, an operator credential utility, and an exact-path middleware exception. The exception skips browser-cookie authentication for that endpoint only; the endpoint imposes its own fail-closed credential and resource checks. App-host rewrite still runs first.

## Read request lifecycle

A client initializes over stdio. The bridge validates the envelope, checks its method/tool allowlist, obtains the configured credential and sends one POST to the pinned Zenith origin. Redirects, ambient browser cookies, automatic retries and session-based MCP responses are not accepted.

The companion validates configuration, origin/Host, method/media type, credential and selected scope. It checks membership inside the application snapshot before dispatching a curated read. The file-backed path claims the application's data directory; the Postgres path uses a request snapshot. It deliberately does not start deployment or alert timers for a read.

Successful results are conservatively redacted, size-bounded and returned as JSON. Logs, error bodies and instructions in returned records are data. The bridge never evaluates them as JavaScript or shell commands.

## ADR 001 — one implementation, generated packages

Both packages contain the same bridge, compiled client and skills. `scripts/build.mjs` generates manifests and marketplace entries with client-specific wrapper/root syntax. Checking equality against source and launching from an isolated directory prevents hidden checkout-relative dependencies. Generated files are committed so plugin startup does not install dependencies.

## ADR 002 — a deliberately limited protocol profile

The current code is a small handwritten adapter for line-delimited stdio and stateless, JSON-response HTTP. It targets declared protocol revisions `2025-11-25`, `2025-06-18`, and `2024-11-05`; these constants are not a claim of independent interoperability certification.

No SDK, OAuth server, session store, SSE reader, resource/prompt service or server-initiated requests are implemented. The bridge accepts initialize, initialized notification, ping, tools/list and allowlisted tools/call. This is a reviewable development increment, not the maintained-SDK/full remote integration required for release. Replace the limited protocol layer and validate actual clients before general distribution.

## ADR 003 — read-only until authoritative writes exist

A prompt or skill cannot enforce approval. Adding executable tools requires durable actor-bound receipts, atomic state/policy rechecks, trusted approval, idempotency across restart and persistent operations in Zenith. Those are separate acceptance gates. The current preview is explicitly non-executable and writes are denied at both exposed boundaries.

## ADR 004 — local operator credentials, not remote OAuth

Short-lived opaque credentials let a local operator exercise the draft without exporting browser cookies or provider keys. The authority file stores hashes, scoped IDs and expiry; live application membership remains necessary. The server is opt-in and loopback-development only. This choice must not be relabeled as MCP OAuth compliance or expanded to public HTTP through configuration alone.

## Limits worth preserving

Request frames are at most 64 KiB; responses at most 256 KiB; bridge concurrency is at most eight calls; request timeout defaults to 15 seconds; pagination is bounded. These are wire limits, not proof that every application query has bounded CPU or memory cost. The process-local 120-request/minute credential throttle is not distributed rate limiting. Nothing here proves horizontal scalability.
