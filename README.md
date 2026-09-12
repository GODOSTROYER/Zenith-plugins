# Zenith integrations

One standalone connector and native Codex/Claude Code packages, generated from shared sources.

**0.2.0-dev.1 — opt-in reviewed operations.** The legacy v1 reader remains the default. Version 2 requires the companion Zenith control implementation; it never turns on server writes or obtains additional permissions automatically.

## Capabilities

V2 exposes up to 24 scoped tools: the thirteen original reads plus exact proposal preparation, browser-approved execution, durable operation tracking, revisions/comparisons, scoped logs, incident bundles, app status and curated edit-field discovery. Supported proposals include manifest replacement, Compose import, service/resource/binding/route edits, deployment, saved-revision rollback/promotion, app creation, supported source publishing and code rollback.

Every change follows **prepare → review in Zenith → execute the existing operation ID → inspect the real outcome**. The agent cannot approve itself. Dispatch success does not mean a deployment is healthy. Provider and source-contract limits remain authoritative in Zenith.

Eleven shared skills cover connect, inspect, plan, edit, deploy, rollback, promote, publish, observe, incident and export. Claude Code additionally includes two read-oriented evidence reviewers; they cannot independently authorize writes.

## Development

```bash
npm ci --ignore-scripts
npm run verify
npm run contracts:check -- --backend /absolute/path/to/zenith
npm run release:prepare
```

Node 22.16 or newer. The TypeScript client and v2 runtime are strict-checked. SDK-backed runtime bundles and dependency notices are included in both generated packages; installing a generated package needs no compiler or runtime dependency installation.

[Version 2 setup and security](docs/control-v2.md) · [Tool reference](docs/tool-reference.md) · [Verification](docs/verification.md) · [Release process](docs/releases.md) · [Remaining scope](docs/roadmap.md)

## Configuration

Use an explicitly selected trusted URL, workspace/project IDs and one credential source. To select v2:

```bash
export ZENITH_API_VERSION=2
export ZENITH_URL=http://127.0.0.1:3400
export ZENITH_ALLOW_LOOPBACK_HTTP=1
export ZENITH_WORKSPACE_ID=WORKSPACE_ID
export ZENITH_PROJECT_ID=PROJECT_ID
export ZENITH_TOKEN_FILE=/absolute/private/client.token
# Optional, only after reviewing the target and granting the appropriate backend scopes:
export ZENITH_ALLOW_WRITES=1
npm run doctor
```

Named profiles, Windows CurrentUser DPAPI credential storage, source preflight/upload and native remote-OAuth configuration are described in [the v2 guide](docs/control-v2.md). Version-1 configuration remains supported separately; there is no implicit credential migration.

## Boundaries

Zenith owns authentication, authorization, actions and persistence. Plugins never open its stores or impersonate Navigator. Writes currently require a long-lived single-writer POSIX Zenith file-store deployment; PostgreSQL writes and serverless control are explicitly refused. Remote OAuth requires your configured authorization provider and matching browser grant. These are not public hosted-service credentials.

Native client installation and real provider/identity-provider acceptance remain separate from automated fixture evidence. No merge, publication or infrastructure deployment is performed by normal builds. No project license grant has been selected.
