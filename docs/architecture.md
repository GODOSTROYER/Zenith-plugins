> **Legacy version-1 reference.** These restrictions and commands describe the retained v1 reader. For current v2 operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

# Architecture

[Home](../README.md) · [Security](security.md) · [Verification](verification.md)

## Ownership

`Zenith-plugins` owns a typed transport client, local stdio process, setup/doctor, generated packages and shared skills. `zenith` owns the authenticated endpoint, application actions, permissions and storage. No plugin imports backend internals or opens a database. Connector processes are clients, not additional application writers; this does not make Zenith horizontally scalable.

The read-only companion endpoint is merged in Zenith at `2d56ecc3abe77f560d9c58bee14370b0789f386a`. Its route is `/api/agent/v1/mcp`, with independent fail-closed credential and resource checks. Full application behavior has not been exercised in this increment.

## Request lifecycle

Trusted user configuration fixes the destination and selected IDs. An ID-only association cannot select an origin or credential. The client snapshots requests before asynchronous work, refreshes file credentials per request, and sends bounded POSTs without cookies, redirects or automatic retry. It validates both protocol envelopes and the versioned read-only result contract.

The stdio boundary progresses through new, initializing, initialized and ready states. Concurrent initialization is refused; readiness requires a successful initialized acknowledgement. Active reads have unique IDs and abort controllers. Cancellation suppresses a cancelled read's reply; shutdown aborts active reads. No protocol cancellation cancels a Zenith deployment.

A read has a deadline covering credential acquisition, HTTP headers and body consumption. File reads, frames, responses and catalog pagination are bounded. Optional diagnostics contain method, generated correlation ID, status, duration, response bytes and outcome, never arguments or bodies.

## ADR 001 — shared source, self-contained distribution

`scripts/build.mjs` regenerates both packages and marketplace definitions. Installed runtimes and all five skills are checked against canonical source recursively. Each package contains a deterministic SHA-256 inventory. `scripts/release.mjs` uses the installed npm CLI in offline, ignore-scripts mode, verifies packed file membership and prepares local review archives. Hashes detect accidental changes; they do not authenticate a publisher.

## ADR 002 — explicit, limited protocol profile

This increment retains the small handwritten adapter for line-delimited stdio and stateless JSON-response HTTP. Declared MCP revisions remain `2025-11-25`, `2025-06-18`, and `2024-11-05`; these are protocol constants, not native-client certification. Zenith success results require `structuredContent.contractVersion = 1` and `mode = "read-only"`.

No maintained MCP SDK, OAuth server, session store, SSE reader, server-initiated methods, resources or prompts are added. Unknown write tools are filtered and cannot be called. Conflicting read-tool annotations or incompatible contracts fail closed. Migration to a maintained SDK and remote transport remains an explicit release gate, not a capability silently claimed by this hardening work.

## ADR 003 — read-only until authoritative writes exist

Neither a prompt nor a model-provided approval field grants permission. Executable tools require durable actor-bound receipts, atomic state/policy checks, trusted approvals and replay-safe operations **in Zenith**. Existing previews remain recomputed, non-executable and not approval evidence. There is no generic raw-action or shell tool.

## ADR 004 — explicit private profiles

Setup creates a new versioned, private profile pointing to an existing private token file. It validates the destination, IDs and file permissions, refuses overwrites and never stores raw tokens in the profile. No default profile discovery or `.env` loading occurs. A profile and individual connection variables cannot be combined ambiguously. On Windows, private-file access fails closed until ACL validation exists; explicit environment credentials remain available.

## Boundaries

Requests: 64 KiB. Responses: 256 KiB. Concurrent reads: eight. Default deadline: 15 seconds. Token files: 256 bytes. ID associations: 4 KiB. Private profiles: 8 KiB. Doctor catalog pagination: four pages maximum. These are transport/configuration limits, not proof of bounded backend query costs or distributed rate limiting.
