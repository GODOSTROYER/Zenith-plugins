> **Legacy version-1 reference.** These restrictions and commands describe the retained v1 reader. For current v2 operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

# Configuration and diagnostics

[Home](../README.md) · [Installation](installation.md) · [Security](security.md)

## Private profile (POSIX)

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
