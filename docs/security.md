# Security and operational boundaries

[Home](../README.md) · [Configuration](configuration.md) · [Remaining work](roadmap.md)

> Do not expose this development reader on a public interface. Remote OAuth and a production security review remain incomplete.

## Protected boundaries

The credential destination is trusted user configuration, never a repository-controlled association field. The client rejects embedded URL credentials, paths, fragments, queries and non-loopback HTTP. Literal loopback HTTP requires a separate opt-in. Redirects are disabled so authorization cannot follow a redirect to another origin.

A credential names a real non-demo subject, one workspace, explicit projects, optional environments and read/plan/export scopes. The authority rereads credential records and application membership on each request. Knowing an ID is not sufficient to read that record. An expired, missing, revoked or out-of-scope credential does not become a demo administrator.

The plugin cannot execute writes even if a future endpoint advertises write tools. It does not expose raw action IDs, credential issuance, access-grant administration, shell execution or source uploads. Repository text cannot provide `approved: true` to create authority that does not exist.

## Credential lifecycle

An operator issues credentials using the companion utility. The default is read-only and one day. Maximum lifetime is 30 days. The server stores SHA-256 token digests; the client holds the token in a private owned file, preferably outside the checkout. POSIX permission and no-follow checks apply; the companion explicitly refuses Windows authority files until ACL behavior is implemented and tested.

Revocation removes the credential record and affects subsequent requests. It does not erase data already read, delete a client-side token copy, or abort every read already in flight. The environment-variable fallback offers no extra protection against processes that can inspect that environment.

## Data minimization is conservative, not perfect

The companion removes common sensitive fields, literal environment values, known token patterns, and embedded URL passwords. It does not expose free-form deployment log events. Redaction is not a universal secret detector: arbitrary plaintext inside user-authored names, provider details, or generated files may not match known patterns. Treat all returned data as potentially sensitive. Do not claim the automated tests prove complete secret non-disclosure.

The HTTP transport does not reflect raw error response bodies. Diagnostic logs carry component, request ID, HTTP status and duration, not tokens or request contents. Model-level prompt-injection resistance is not proven by a transport test that returns malicious prose inertly.

## Deployment requirements

Use `--hostname 127.0.0.1` and an isolated development data directory. A Host or Origin check does not prevent an outside caller from supplying matching headers when the socket is publicly reachable. Do not reverse-proxy or tunnel this endpoint. The `VERCEL` guard is an additional refusal, not a universal serverless detector.

The bridge has bounded requests/results and no automatic retry. The server's credential throttle is per process. Its file utility assumes a private, trusted operator directory and serialized issuance. Do not remove a lock without first checking for an active operator process. Directory-ancestor races, body-read deadlines, production metrics, delegated OAuth consent and full application authorization tests require further review.

## Before enabling writes

Require durable plan receipts bound to actor, workspace/project/environment, exact inputs and relevant state/policy versions. Validate and claim execution atomically. Recheck membership, scopes and app grants. Record uncertain outcomes for reconciliation rather than retrying a possibly completed write. Production/destructive operations need a trusted approval channel; an agent-authored boolean is not approval.

## Reporting a concern

Send sensitive reproduction material privately to the repository owner. Do not put credentials, database exports or private application data into a public issue, PR description, screenshot or agent transcript. Rotate any disclosed credential immediately and record only its identifier in the report.
