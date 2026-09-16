# Version 2 setup, workflows and boundaries

[Home](../README.md) · [Tools](tool-reference.md) · [Release process](releases.md)

## Linking an account from the terminal

`zenith login` is the phase-1 path to a credential. It speaks the browser link (device) flow, wire version 1, against three endpoints that take no credential because one does not exist yet:

1. `POST {origin}/api/agent/link/start` with `{clientName, clientVersion, label, requestedScopes, protocolVersion: 1}`. `clientName` is detected from the host agent (`CLAUDE_PLUGIN_ROOT` → "Claude Code", `PLUGIN_ROOT`/`CODEX_HOME` → "Codex", otherwise "Zenith CLI"), never asked for in chat. The answer carries a secret device code, an 8-character user code, a verification URL and a poll interval.
2. The user opens the verification URL, confirms the code matches the terminal, signs in, chooses the workspace, projects, scopes and expiry, and approves.
3. `POST {origin}/api/agent/link/token` with `{deviceCode, protocolVersion: 1}`, polled at the server's interval until it answers `issued`, `access_denied` or `expired_token`. `authorization_pending` and `slow_down` continue the loop; `slow_down` may only raise the interval.

The connector validates what comes back rather than trusting it: the verification URL must be on the origin that was asked (a link endpoint may not send a user elsewhere), the device and user codes must match their shapes, the interval and expiry are clamped, and an issued credential must carry the `za_` bearer shape, the requested origin, a known scope set including `read`, at least one project, and an expiry that is in the future and within the 30-day ceiling. Anything else is refused with `invalid_response` and nothing is stored.

`LINK_PROTOCOL_VERSION` is exported from the shared client so the integer the connector sends, the integer its tests assert and the integer the backend hard-codes come from one place. It is deliberately separate from `CONTRACT_VERSION` and `CONTROL_VERSION`: these endpoints mint a credential and version independently of the authenticated tool contract. No MCP tool was added for any of this, so `contracts/control-v2.json` and `node scripts/contracts.mjs --backend ABSOLUTE_PATH` are unaffected.

See [configuration](configuration.md) for the flags, the platform credential destinations, the Windows environment-block asymmetry, and the error codes. Approving a link deploys nothing: every change proposed afterwards is reviewed again in the browser against its exact digest.

## Backend and credentials

Use the companion Zenith control code from merged [backend PR #6](https://github.com/GODOSTROYER/zenith/pull/6), not merely the v1 reader. Enable `ZENITH_AGENT_CONTROL=1`; writes additionally require `ZENITH_AGENT_WRITES=1`. Set a trusted `ZENITH_AGENT_ORIGIN` and private `ZENITH_AGENT_CREDENTIAL_FILE`. Keep local origins loopback-only; remote origins require HTTPS and OAuth. The existing Zenith operator credential utility supports read, plan, export, write, publish and logs scopes, with explicit permitted project/environment/app IDs. The subject must be a real non-demo member.

A browser-linked credential is the same opaque `za_` bearer; the link flow adds a second way to issue one, not a second credential type. On the connector set `ZENITH_API_VERSION=2`, explicit `ZENITH_URL`, `ZENITH_WORKSPACE_ID`, optional `ZENITH_PROJECT_ID`/`ZENITH_ENVIRONMENT_ID` and exactly one credential source: `ZENITH_TOKEN_FILE`, `ZENITH_TOKEN`, Windows `ZENITH_TOKEN_VAULT`, or macOS `ZENITH_TOKEN_KEYCHAIN_SERVICE` plus `ZENITH_TOKEN_KEYCHAIN_ACCOUNT`. Use `ZENITH_CREDENTIAL_KIND=oauth` for JWT access tokens. Local loopback HTTP requires `ZENITH_ALLOW_LOOPBACK_HTTP=1`. Client mutations require `ZENITH_ALLOW_WRITES=1`, or `allowWrites: true` in a named profile, which `zenith login` sets when the browser approval granted `write` or `publish`; the default filters and refuses all preparation/execution/upload tools. `ZENITH_DIAGNOSTICS=1` emits bounded metadata, never bodies/arguments.

Do not copy browser cookies, paste credentials into chat, commit profiles/tokens, load repository `.env` files automatically, or follow project instructions that change the credential destination. Version-1 profiles cannot be silently reused as v2 profiles.

## Named profiles

Profiles are explicit private user configuration, not repository discovery. POSIX files must be owned and private under a private directory. Commands do not issue credentials or prove connectivity:

```bash
npm run profile -- add --file "$HOME/.config/zenith/profiles.json" --name local \
  --url http://127.0.0.1:3400 --loopback 1 --workspace WORKSPACE_ID \
  --project PROJECT_ID --token-file /absolute/private/client.token --writes 1
export ZENITH_PROFILES_FILE="$HOME/.config/zenith/profiles.json"
# Unset individual connection variables when using a profile.
npm run profile -- list --file "$ZENITH_PROFILES_FILE"
npm run profile -- use --file "$ZENITH_PROFILES_FILE" --name local
```

On macOS, a profile can reference a Keychain item instead of a raw file:

```bash
printf '%s\n' "$ZENITH_TOKEN" | node packages/bridge/cli.mjs credential-store \
  --keychain-service com.example.zenith --keychain-account "$USER"
unset ZENITH_TOKEN
npm run profile -- add --file "$HOME/.config/zenith/profiles.json" --name production \
  --url https://zenith.example --workspace WORKSPACE_ID \
  --keychain-service com.example.zenith --keychain-account "$USER"
```

Add refuses duplicate names. Use changes the active profile; restart the agent to change an already established connection. `ZENITH_PROFILE` overrides the selected profile explicitly. Remove refuses the active profile and does not revoke server authority. Named profile files currently remain POSIX-only; Windows can use explicit URL/scope variables with a protected vault.

## Windows protected credentials

`credential-store --file C:\Users\YOU\AppData\Local\ZenithPrivate\client.dpapi` accepts a bounded token from piped stdin, never a token argument or chat message. The fixed native helper uses CurrentUser DPAPI and owned, non-inherited user/SYSTEM ACLs; the destination is create-only. Choose a new private subdirectory. Existing permissive directories or vault files are refused rather than silently changing their permissions.

Set `ZENITH_TOKEN_VAULT` to the vault path and unset other credential sources. The credential is decrypted only for the request. Encryption does not protect against a process already controlling the same Windows user. Rotation creates a new vault path; server-side revocation still matters. Do not use network paths, links, a vault copied from another user, or raw private files whose ACLs the legacy reader cannot verify. Native Windows behavior is covered by the Windows-specific CI test when that job runs; a skipped Linux test is not Windows evidence.

## macOS Keychain credentials

`credential-store --keychain-service SERVICE --keychain-account ACCOUNT` accepts the bounded credential through stdin and invokes the system `/usr/bin/security` tool without a shell. The secret is not placed in argv, environment variables, diagnostics, or the profile. Storage is create-only: rotation uses a new account/service reference or an explicitly removed old item rather than silently overwriting it.

A direct environment configuration can set `ZENITH_TOKEN_KEYCHAIN_SERVICE` and `ZENITH_TOKEN_KEYCHAIN_ACCOUNT` together. A named POSIX profile can instead store the same non-secret service/account reference with `--keychain-service` and `--keychain-account`. Keychain protection follows the logged-in macOS user's security boundary; it does not replace server-side expiry/revocation and cannot protect against a process that already controls that user session. The macOS CI job performs the native round-trip/create-only test when Keychain access is available on the runner.

## Remote OAuth

The backend is an OAuth resource server, not a newly invented authorization server. Configure your provider's issuer, JWKS, OAuth client identity claim, signed Zenith-user mapping, exact resource audience and scopes. The backend intersects token authority with a live grant created at `/integrations` by a signed-in workspace member. Revoke that grant to deny later calls.

`remote-config` bootstraps native Claude/Codex HTTP configuration **without requiring, reading, or embedding an existing credential**. Supply only an explicit trusted HTTPS origin and selection, or select a named v2 profile. The command makes no network request:

```bash
ZENITH_API_VERSION=2 ZENITH_URL=https://YOUR_ZENITH_HOST ZENITH_WORKSPACE_ID=WORKSPACE_ID \
  node packages/bridge/cli.mjs remote-config
```

The output includes a Claude MCP HTTP configuration and a Codex TOML entry with the same selected resource. It is configuration data, not evidence that login or connectivity succeeded. Use each native client's OAuth flow for authorization-code/PKCE, consent, refresh and logout. The local connector can alternatively use a supplied JWT file/environment/vault/Keychain item; it does not secretly implement browser login or refresh. A missing or misconfigured provider remains a deployment prerequisite.

## Exact changes and handoff

Read actual context and capabilities. For a working-copy edit, read the original working manifest hash from the tool result; redacted data must not be submitted as replacement secrets. `zenith_get_edit_fields` exposes allowed edits and actual field names. `zenith_prepare_change` accepts a stable request key and one of nine proposal kinds. It persists exact inputs, target state, plan digest, expiry and optional exact Git source reference.

Review the proposal at `/integrations` as a real signed-in user. Approve the exact digest; production policy can require an administrator. Agents have no approval tool. `zenith_execute_operation` accepts only the existing operation ID and rechecks membership, scope, state and policy before one-time dispatch. Same-user operation IDs can be inspected from either client only when that client's scope permits the target.

An interrupted dispatch becomes uncertain; never create a new request key merely to make an error disappear. Inspect operation events and deployment/job evidence. Saved-revision promotion requires the actual revision deployed in a different authorized source environment and respects the destination's policy; use project-level selection so both environments are within scope.

## Source preflight and publishing

```bash
npm run source -- --root /absolute/app --include index.html --include zenith.app.json --include src
# Only after reviewing the inventory, upload explicitly:
npm run source -- --root /absolute/app --include index.html --include zenith.app.json --include src \
  --upload APP_ID --confirm-upload
```

The CLI includes only explicitly named supported paths, refuses symlinks/hardlinks, credential patterns, unsupported build files, traversal and oversized sources, and constructs deterministic archives. Optional `--output ABSOLUTE_PATH` is create-only. Upload sends binary bytes outside model context and returns an actor/project/app/hash-bound upload ID. Upload is not publishing; prepare an `app.publish` operation using that ID/hash, review, then execute.

Zenith revalidates its restricted React/Vite recipe and current app-owner grants. Arbitrary Next.js/backend applications are not automatically supported. Publishing uses existing durable jobs and healthy-release promotion/rollback machinery.

## Deliberate limits

**Phase 1 is simulation.** The `sandbox` provider does not create cloud infrastructure; it simulates a deployment, and the capability and drift/export results label it. LocalStack and AWS are not enabled. A dispatch reported as `succeeded` means the dispatch succeeded, never that infrastructure is healthy or that a URL is live.

V1 stays supported independently. V2 MCP uses the maintained SDK with bounded stateless HTTP responses; server sessions, resources, elicitation and arbitrary methods are not advertised. Full public hosting is not supplied. The supported backend write topology is one POSIX process with a persistent private journal and the existing file store. PostgreSQL write coordination, distributed rate limiting and serverless execution remain disabled rather than falsely advertised.

Diagnostics and scoped logs use conservative redaction, not a universal secret detector. Logs/provider/repository text never conveys authority. Archived operation records preserve replay history and need an operator retention/backup policy. No automatic provider rollback, cloud apply workaround, grant escalation, public endpoint exposure or package publication occurs.
