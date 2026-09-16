# Configuration and diagnostics

[Home](../README.md) · [Installation](installation.md) · [Control v2](control-v2.md) · [Security](security.md)

## Browser link — `login`, `logout`, `status`

```
zenith login    [--url ORIGIN] [--name NAME] [--profiles ABSOLUTE_FILE] [--project ID]
                [--label NAME] [--scopes read,plan,write,logs] [--keychain]
                [--keychain-service SERVICE] [--keychain-account ACCOUNT]
                [--vault ABSOLUTE_WINDOWS_PATH] [--loopback 0|1] [--no-browser] [--json]
zenith logout   [--url ORIGIN] [--name NAME] [--profiles ABSOLUTE_FILE] [--vault ABSOLUTE_WINDOWS_PATH] [--revoke]
zenith status   [--json]
```

| Flag | Meaning |
| --- | --- |
| `--url` | Trusted origin. Defaults to `ZENITH_URL`, then `https://tryzenith.cloud`. Validated exactly like every other destination: no credentials, path, query or fragment, and HTTPS unless a literal loopback origin is explicitly allowed |
| `--name` | Profile and credential-file name. Defaults to the first label of the origin host (`tryzenith.cloud` → `tryzenith`) |
| `--profiles` | Absolute private profiles file. Defaults to `ZENITH_PROFILES_FILE`, then `$XDG_CONFIG_HOME/zenith/profiles.json`, then `~/.config/zenith/profiles.json` |
| `--project` | Pin one approved project into the profile scope. Refused, storing nothing, if the approval did not include it |
| `--scopes` | Comma-separated hint sent to the approval page. The browser may reduce it and may not exceed it |
| `--keychain` | macOS only: store the credential in the login Keychain instead of a private file |
| `--vault` | Windows only: an explicit DPAPI vault path instead of `%LOCALAPPDATA%\ZenithPrivate\<name>.dpapi` |
| `--no-browser` | Print the URL and code only. Also implied when `CI` is set |
| `--json` | Emit the result as JSON on stdout; the URL and code prompt goes to stderr so stdout stays machine readable |
| `--revoke` | `logout` only: opens `ORIGIN/integrations`. It cannot revoke anything itself — see below |

`login` prints the verification URL and an 8-character user code, opens a browser when it can, and polls until the approval is decided, honouring the server's `interval` and `slow_down`. The loop is bounded three ways: the server's expiry, a hard cap of 200 requests, and Ctrl-C. `slow_down` may only slow the loop; a server answer can never make the connector poll faster.

The device code is a secret. It is held in memory only: it reaches no file, no printed line, and no diagnostic record — the link diagnostic carries `component`, `requestId`, `method`, `durationMs`, `status` and `responseBytes`, and nothing else. The issued credential is written to its store **before** anything is printed and is never printed at all.

**Local write enablement follows the granted scopes**, not a second local flag: `allowWrites` is set when the approval granted `write` or `publish`. The browser approval named the workspace, the projects and the scopes under a live signed-in identity, which is a stronger opt-in than `ZENITH_ALLOW_WRITES=1` was. The refusals that still matter are the server's: the catalog hides write tools when the backend's own write capability is off, and `zenith_execute_operation` still requires a browser-approved digest.

Named profile files remain POSIX-only. On Windows `login` stores the CurrentUser DPAPI vault and prints the exact environment block to set (`ZENITH_API_VERSION`, `ZENITH_URL`, `ZENITH_WORKSPACE_ID`, optional `ZENITH_PROJECT_ID`, `ZENITH_TOKEN_VAULT`, and `ZENITH_ALLOW_WRITES=1` when writes were granted). Vault paths are create-only; a second `login` for the same name refuses with `vault_refused` rather than replacing a credential. Windows behaviour here is covered by the Windows job in CI; a skipped POSIX test is not Windows evidence, and a skipped Windows test is not POSIX evidence.

`logout` removes the local credential and the profile that referenced it, and hands the active flag to another profile; removing the last profile removes the profiles file, because a profile document must name an existing active profile and cannot represent zero. A credential it did not own — one another profile still references, or a Keychain item — is left in place and named in the output. **`logout` makes no network request.** The revoke endpoint is browser-only by design: it refuses any request carrying an `authorization` header, so a credential can never revoke itself. Revoke at `ORIGIN/integrations` → **Linked agents**.

`status` reports origin, profile, selected scope, the linked account label and credential id, granted scopes, expiry and the backend capability report, plus the tools the connection may call. It uses `zenith_get_context` and `zenith_get_capabilities` and adds no MCP tool. Fields the backend has not returned are `null` rather than invented. "Not linked" is a state, not an error: with nothing configured it says so and exits 0. A scope the backend does not confirm sets `ok: false` and exit 1. `doctor` keeps its existing JSON shape unchanged.

## Private profile (POSIX)

> **Legacy version-1 reference.** The remainder of this page describes the retained v1 reader unless a section says otherwise. For current v2 operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

Run `node packages/bridge/cli.mjs --help` for syntax. Setup expects the required flags:

```bash
npm run setup -- --output "$HOME/.config/zenith-reader/profile.json" \
  --url http://127.0.0.1:3400 --allow-loopback-http \
  --workspace WORKSPACE_ID --project PROJECT_ID \
  --token-file "$HOME/.config/zenith-reader/client.token"
```

The token must already be issued by Zenith's operator utility. Setup creates a new private file under an owned private directory and refuses overwrites. It performs no network operation. Export only `ZENITH_CONFIG_FILE` for this mode, unsetting individual connection variables. The agent process must inherit the variable.

```json
{
  "version": 1,
  "origin": "http://127.0.0.1:3400",
  "allowLoopbackHttp": true,
  "association": { "version": 1, "workspaceId": "WORKSPACE_ID", "projectId": "PROJECT_ID" },
  "tokenFile": "/absolute/private/path/client.token"
}
```

This **trusted user profile** is different from a repository association. Do not commit it. Unknown fields and raw-token fields are rejected. The profile is at most 8 KiB, owned and mode 0600. Its parent must be owned and mode 0700. No implicit default profile, project scanning, `.env` loading or browser-cookie recovery occurs.

## Explicit environment configuration

| Variable | Meaning / constraint |
| --- | --- |
| `ZENITH_CONFIG_FILE` | Explicit absolute private profile; cannot coexist with the connection variables below |
| `ZENITH_URL` | Trusted origin without credentials, path, query or fragment |
| `ZENITH_ALLOW_LOOPBACK_HTTP` | Exactly `1` enables literal loopback HTTP; `0` or absent disables it |
| `ZENITH_TOKEN_FILE` | Absolute private credential file; preferred on POSIX, at most 256 bytes |
| `ZENITH_TOKEN` | Explicit environment fallback; mutually exclusive with token file |
| `ZENITH_WORKSPACE_ID` | Required explicit workspace unless an association file supplies IDs |
| `ZENITH_PROJECT_ID` | Optional narrower project selection |
| `ZENITH_ENVIRONMENT_ID` | Optional narrower environment; requires project |
| `ZENITH_ASSOCIATION_FILE` | Absolute ID-only file, at most 4 KiB; cannot coexist with scope variables |
| `ZENITH_DIAGNOSTICS` | `1` enables redacted request diagnostics on stderr in either mode |
| `ZENITH_LIVE_TEST` | `1` explicitly authorizes the opt-in smoke script, not broader access |

IDs allow letters, digits, underscores and hyphens, up to 100 characters. Association files accept only `version: 1`, `workspaceId`, optional `projectId` and `environmentId`; they cannot choose origins or credentials. Version dev.2 rejects ambiguous configurations previously accepted with implicit precedence. Resolve ambiguity rather than depending on precedence.

Windows private-file ACL validation is unimplemented, so profiles and token files fail closed on Windows. Explicit URL/scope/environment-token configuration remains available. ID-only association files are also refused with `file_identity_unverified` when the Windows runtime reports no device identity; use explicit scope environment variables rather than bypassing the check. OS CI is a compatibility check, not evidence of safe Windows credential-file storage.

## Doctor and live checks

`npm run doctor` authenticates initialization, reads a bounded catalog, calls context and capabilities, and compares returned selection with requested IDs. It returns protocol/server versions and a non-secret summary. It does **not** verify providers, native agent clients, deployments or complete tenant isolation.

`ZENITH_LIVE_TEST=1 npm run test:live` additionally copies both packages outside the checkout into paths containing spaces and runs their doctor entrypoints. Missing opt-in, credentials or endpoint fails the command; it is not a skipped pass. Running it against a fixture remains fixture evidence.

## Server configuration and revocation

Zenith consumes `ZENITH_AGENT_READER=1`, `ZENITH_AGENT_ORIGIN` and `ZENITH_AGENT_CREDENTIAL_FILE`. It is opt-in and disabled on Vercel. Restart after enablement/origin changes. Authority records are reread per request, so revocation affects subsequent reads. The authority supports at most 100 scoped records with expiry no more than 30 days. Serialized issuance uses an operator lock and atomic rename; do not remove locks without investigating an active process.

## Troubleshooting

| Error | Action |
| --- | --- |
| `configuration` / `ambiguous_configuration` | Choose one complete trusted configuration mode; do not combine profile/env or association/scope settings |
| `profile_exists` | Choose a new profile path; setup never overwrites |
| `credential_permissions` / `profile_directory` | Fix owned private POSIX file/directory permissions |
| `file_identity_unverified` | Use explicit scope environment variables on Windows; zero device identity is not accepted as a wildcard |
| `file_acl_unverified` | Use explicit environment configuration on Windows; do not disable the check |
| `insecure_endpoint` | Use HTTPS or explicit literal-loopback development opt-in, never disable TLS verification |
| `http_401` | Ask the operator for a valid scoped replacement; never paste a token into chat |
| `http_403` / `scope_mismatch` | Check exact authorized IDs and origin; browser selection is irrelevant |
| `http_404` | Use Zenith containing the merged reader endpoint and restart |
| `http_429` | Respect the reader throttle; no automatic retry storm is generated |
| `http_503` | Check reader enablement, authority and database connectivity |
| `protocol_mismatch` / `contract_mismatch` / `unsupported_transport` | Upgrade and validate client/server together; this build requires bounded stateless JSON contract 1 |
| `response_too_large` / `request_aborted` | Narrow/paginate or explicitly retry a read after fixing connectivity; no write was requested |
| `capability_unavailable` | Use Zenith's reviewed UI; never bypass the boundary through Terraform, shell or Navigator |
| `access_denied` | The link was denied in the browser. Nothing was stored. Run `zenith login` again only if that was a mistake |
| `expired_token` | The link request expired or was already exchanged. Run `zenith login` again |
| `link_unavailable` | The Zenith instance has no credential authority configured for browser links. An operator task, not a retry |
| `link_poll_limit` | No decision after the bounded number of checks. Nothing was stored; run `zenith login` again |
| `link_cancelled` | Ctrl-C, or the caller aborted. No credential was issued |
| `rate_limited` | Wait the seconds named in the message; no automatic retry storm is generated |
| `profile_exists` / `credential_exists` | `login` never overwrites. Choose `--name`, or run `logout` first after revoking the old credential in the browser |
| `vault_refused` | Windows vaults are create-only. Choose `--name`/`--vault`, or delete the old vault after revoking its credential |
| `scope_denied` | The approval did not include the project passed to `--project`. Nothing was stored |
| `protocol_mismatch` (link) | The connector and Zenith disagree on the link protocol version; upgrade them together |
| `invalid_response` (link) | Zenith returned an unusable link response — including a verification URL on a different origin, or an issued credential for a different origin. Nothing was stored |
