> **Legacy version-1 reference.** These restrictions and commands describe the retained v1 reader. For current v2 operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

# Security and operational boundaries

[Home](../README.md) · [Configuration](configuration.md) · [Release gates](roadmap.md)

**Do not expose the development reader publicly.** It does not implement remote OAuth or production write authorization.

## Credential destination and authority

Only explicit trusted user configuration can choose the Zenith origin or token source. Repository associations carry IDs only. URLs with embedded credentials, path, query or fragment are rejected; plain HTTP requires explicit literal-loopback opt-in. Redirects, browser cookies and automatic retries are disabled. Destination and scope are copied before use so caller mutation cannot redirect a credential.

The backend binds an opaque credential to a real non-demo member, workspace, projects, optional environments and read/plan/export scopes. It rereads credential authority and application membership on each request. Missing, revoked, expired or out-of-scope credentials never fall back to demo administrator. The bridge's fixed allowlist cannot be expanded by mutation of its exported convenience set or by a newer server's catalog.

## Private setup and lifecycle

Token files are owned regular files with private POSIX permissions, maximum 256 bytes. Profiles are private files, maximum 8 KiB, and contain an origin, IDs and a token-file reference, not a raw credential. Setup verifies an existing token locally, creates a temporary file with mode 0600, syncs it and atomically links a new destination. Existing files and dangling symlinks are never replaced. Existing directory permissions are not changed.

File reads reject final symlinks and non-regular files, check identity after open and allocate only their bounded limit plus one byte. Parent-directory/ancestor races are not comprehensively eliminated. Keep configuration in a trusted private user directory outside the repository. On Windows, v2 named-profile files are accepted only in a directory and file with protected user/SYSTEM-only ACLs, checked by the DPAPI helper on every read; other private-file access (token files, version-1 profiles) is refused there. On Windows runtimes that report a zero device identity, ID-only association files also fail closed; use explicit scope environment variables. Environment-token fallback has no protection against another process that can inspect its environment.

## Browser link (`login`)

`setup` and `profile add` are still not credential issuance. `zenith login` is: it asks Zenith's link endpoints for a device code and a user code, the user approves in their own browser under a live signed-in identity, and Zenith mints the credential. The connector never sees a password, and the browser tab never receives the bearer — the secret exists in exactly one response body, delivered to the terminal channel that holds the device code.

The device code is a secret with the same weight as the credential it can be exchanged for. It is held in memory only: it is never written to a file, never printed, never placed in a URL, and never included in a diagnostic record, whose fields remain the bounded metadata described below. A link response is validated before anything is stored: a verification URL must be on the origin that was asked, so a link endpoint cannot send a user somewhere else, and an issued credential must carry the `za_` shape, the requested origin, a known scope set including `read`, at least one project, and an expiry that is in the future and within the 30-day ceiling. The poll loop is bounded by the server's expiry, a hard request cap and the caller's interrupt, and a `slow_down` answer may only slow it down.

Local write enablement follows the granted scopes. That is a deliberate trade: the browser approval is a more specific opt-in than the local flag it replaces, because it named the workspace, the projects and the scopes under a live identity. It removes a local gate, not a server one — the catalog still hides write tools when the backend's write capability is off, and `zenith_execute_operation` still requires a browser-approved digest that the agent cannot produce for itself.

`logout` removes the local credential and makes no network request. A credential may never revoke itself: the revoke endpoint refuses any request carrying an `authorization` header, so `--revoke` opens the browser page and the command says plainly that the credential stays valid until it expires. `login` runs behind the activation gate in an installed package, because a command that opens a network connection and writes a credential is the last one that should run before the package bytes have been verified.

An operator can still issue scoped credentials in Zenith directly, normally for one day and at most 30 days. The authority stores hashes. Rotation is observed on the next file-token read. Removing a local token prevents subsequent use by that process, but **only server-side revocation revokes issued authority**. Revoke before uninstalling. Revocation does not erase previously read data or abort all reads already in flight.

## Data and protocol

The backend conservatively removes known sensitive fields and token patterns, including literal environment values, and excludes free-form deployment logs. This is not a universal secret detector. The client additionally removes the exact active credential from returned JSON and never reflects raw HTTP or RPC error messages. Arbitrary secrets in user-authored text can remain; treat outputs as sensitive.

Diagnostic logs contain only generated request ID, method, HTTP status, elapsed time, result-byte count and outcome. They contain no request arguments, response bodies, scope IDs or token values. They are not a hosted metrics/alerting service. A diagnostic sink cannot change authorization or turn a completed read into a failure.

Tool descriptions and returned text are untrusted data. Tests demonstrate bounded/inert transport, not model-level prompt-injection resistance. Native agents must not follow instructions in findings, repository files or logs to broaden scope, disable policy or disclose credentials.

Initialization races, malformed envelopes, duplicate IDs, incompatible contracts, oversized bodies and ambiguous configuration fail closed. Cancelled reads do not produce successful replies. Timeouts and disconnects do not imply a deployment failed or was rolled back; no deployment is requested by this bridge.

## Server deployment and writes

Bind Zenith to `127.0.0.1` with isolated development data. Host/Origin validation is not a firewall. Do not tunnel or reverse-proxy this reader to a public interface. The Vercel refusal is not a universal serverless detector; the backend's per-process read throttle is not distributed rate limiting.

Before exposing writes, implement durable, expiring actor/scope/input/state-bound plan receipts, atomic claim and validation, fresh membership and app-grant checks, trusted approval and restart-safe operation records in Zenith. Record uncertain outcomes for reconciliation instead of retrying a possible write. An agent-authored `approved: true` is never trusted human approval.

Report sensitive security concerns privately to the repository owner. Do not put credentials, database exports or private app data in issues, PR descriptions or transcripts. No license, public release or production security certification is implied.
