# Configuration and diagnostics

[Home](../README.md) · [Installation](installation.md) · [Security](security.md)

## Client environment

| Name | Meaning | Default / constraints |
| --- | --- | --- |
| `ZENITH_URL` | Trusted Zenith origin | Required; no path, query, fragment or embedded credentials |
| `ZENITH_ALLOW_LOOPBACK_HTTP` | Permit HTTP for literal loopback development | Disabled; set exactly `1` |
| `ZENITH_TOKEN_FILE` | Absolute path to the operator-issued token | Preferred; owned regular file, private POSIX permissions, at most 256 bytes |
| `ZENITH_TOKEN` | Explicit environment fallback | Mutually exclusive with the token file; environment protection is the user's responsibility |
| `ZENITH_WORKSPACE_ID` | Explicit workspace selection | Required unless provided in the association file |
| `ZENITH_PROJECT_ID` | Narrow selection to one project | Optional; never enlarges credential permissions |
| `ZENITH_ENVIRONMENT_ID` | Narrow selection to an environment | Requires project selection |
| `ZENITH_ASSOCIATION_FILE` | Absolute path to an ID-only association | Optional; replaces ID environment selection, at most 4 KiB |

A repository cannot choose the credential destination through its association file. There is no automatic project scanning, `.env` loading, cookie reading, or token recovery from the browser.

```json
{
  "version": 1,
  "workspaceId": "WORKSPACE_ID",
  "projectId": "PROJECT_ID",
  "environmentId": "ENVIRONMENT_ID"
}
```

Only these fields are accepted. Endpoint and credential fields are refused. IDs allow letters, digits, underscores and hyphens, up to 100 characters. Configure the file deliberately; it is not discovered by walking parent directories.

## Development server environment

The companion consumes `ZENITH_AGENT_READER=1`, `ZENITH_AGENT_ORIGIN`, and `ZENITH_AGENT_CREDENTIAL_FILE`. It is disabled otherwise and on Vercel. Restart the server after changing enablement/origin configuration. Credential records are reread per request, so file-based revocation applies to subsequent requests without a restart. A read already in flight is not retroactively recalled.

The credential file holds version 1 and at most 100 records. Each record contains a token hash, subject, workspace, explicit project allowlist, optional environment allowlist, scopes, issuance time and expiry. Expiry is limited to 30 days. Removing a record revokes it. The operator utility uses a lock directory and atomic rename; stale locks require operator investigation, not automatic deletion.

## Troubleshooting

| Symptom | Likely boundary | What to do |
| --- | --- | --- |
| `configuration` | Required trusted configuration is absent | Set origin, selection and one credential source in the client process |
| `insecure_endpoint` | HTTP is not explicitly allowed for literal loopback | Use the documented development origin and opt-in; never disable TLS checks |
| `credential_permissions` | Token file is not private, owned, regular or bounded | Correct its owner/mode and use a new private file |
| `http_401` | Token is absent, expired, invalid or revoked | Ask the operator to issue a scoped replacement; do not paste it into chat |
| `http_403` | Selection or origin is not authorized | Check exact IDs, allowlists and origin; a different browser workspace will not help |
| `http_404` | Companion endpoint is missing | Review/apply the paired Zenith branch and restart |
| `http_429` | Process-local reader limit exceeded | Wait one minute; no automatic retry storm is generated |
| `http_503` | Disabled reader or unavailable authority | Inspect server configuration, credential file and database connectivity |
| `unsupported_transport` | Server offered SSE-only or stateful sessions | Use the matching stateless JSON-response companion |
| `protocol_mismatch` | Negotiated revision is unsupported | Upgrade and validate client and server together |
| `response_too_large` | Bounded result exceeded 256 KiB | Narrow scope, use pagination, or inspect through Zenith |
| `capability_unavailable` | Requested operation is outside this draft | Use Zenith's reviewed UI; do not invoke another tool to bypass the boundary |

Client errors never reflect arbitrary HTTP error bodies. The companion logs request ID, status and duration, not request bodies or credentials. These are diagnostics, not a deployed metrics/alerting platform.
