# Zenith for Claude Code and Codex

[![Verify development packages](https://github.com/GODOSTROYER/Zenith-plugins/actions/workflows/verify.yml/badge.svg)](https://github.com/GODOSTROYER/Zenith-plugins/actions/workflows/verify.yml)

Install the Zenith plugin in Claude Code or Codex, link it to your [tryzenith.cloud](https://tryzenith.cloud) account in the browser, and then ask your agent to architect, simulate and deploy the app you are building. The agent reads your real workspace, prepares an exact change, and hands it to you for approval in the browser — you review what it will actually do, approve it there, and the agent executes the operation you approved and reports the real outcome on the Zenith canvas. It cannot approve its own work. In phase 1 every deployment is **simulated** by the `sandbox` provider; LocalStack and AWS are planned and not enabled.

## Requirements

Node 22.16 or newer, and a [tryzenith.cloud](https://tryzenith.cloud) account that is a member of a real workspace.

## Quick start

**Claude Code** — two commands:

```
/plugin marketplace add GODOSTROYER/Zenith-plugins
/plugin install zenith@zenith
```

**Codex** — the same marketplace, through `/plugins`:

```
/plugins
# add the marketplace GODOSTROYER/Zenith-plugins, then install zenith
```

> The repository is private today, so both commands need it to be public, or your client to be authenticated to it. That visibility decision belongs to the repository owner.

Then **ask the agent to link your Zenith account**. It runs the connector's `login`, which prints a URL and a code and waits while you approve in the browser:

```
Zenith link

  1. Open   https://tryzenith.cloud/agent/link?code=K7QM-3XRB
  2. Check the code shown there matches:   K7QM-3XRB
  3. Sign in, choose the workspace and projects, and approve.

Waiting for approval (expires in 10 minutes). Press Ctrl-C to stop.
```

Open the link, check the code matches the one in your terminal, choose the workspace, the projects and the scopes, and approve. The credential is stored in your platform's credential store — it is never printed, and never belongs in the conversation. Restart or reconnect the Zenith MCP server afterwards: it reads the credential when it starts.

[Installation](docs/installation.md) is the detailed reference: per-platform credential destinations, the Windows environment block, other clients, and the signed-release install.

## What you can ask

- "Link my Zenith account."
- "What services and environments does this project have right now?"
- "Add a Postgres resource to the staging environment and prepare the change for review."
- "Deploy the current manifest to staging and tell me what actually happened."
- "The last deploy looks wrong — show me the logs and compare the last two revisions."
- "Roll back to the previous saved revision."

Twelve skills ship with the plugin — link, connect, inspect, plan, edit, deploy, rollback, promote, publish, observe, incident and export — so the agent knows the shape of each of these requests. Claude Code also gets two read-only evidence reviewers, which cannot authorise a write.

## How approvals work

1. **Propose.** The agent prepares an exact change and gets back an operation with a digest of precisely what will run.
2. **Review.** You open `tryzenith.cloud/integrations`, read the change, and approve that exact digest. Nothing the agent says can stand in for this step, and the agent cannot approve itself.
3. **Execute.** The agent executes the operation you approved — the same ID, the same digest, once.
4. **Watch.** The outcome lands on the Zenith canvas. Dispatching an operation is not the same as a healthy deployment, and the agent reports what actually happened, including when the result is genuinely uncertain.

Approving the initial link deploys nothing. Write access exists only if the browser approval granted the `write` or `publish` scope, and Zenith re-checks the actor, the grant, the target and the digest at execution time.

## Manage access

```bash
node runtime/bridge/cli.mjs status     # origin, account, granted scopes, expiry, capabilities
node runtime/bridge/cli.mjs logout     # removes the local credential only
```

`logout` does not revoke anything — a credential can never revoke itself. Revoke at `https://tryzenith.cloud/integrations` → **Linked agents**, which is also where you see every linked client, what it was granted, and when it expires.

## Trust

| Question | Answer |
| --- | --- |
| Who authorises an operation | Zenith, against the credential your browser issued, scoped to the workspace, projects and scopes you approved. |
| Can the agent approve its own change | No. Execution requires a digest approved in the browser by a signed-in person. |
| Where does the credential live | Your platform's credential store: a private 0600 file on Linux, the macOS Keychain with `--keychain`, a CurrentUser DPAPI vault on Windows. It is never printed or logged. |
| Are the plugin bytes publisher-verified | **Not today.** The marketplace packages are unsigned previews: installing one proves your client downloaded this repository's package, not who produced it. `login`, `status` and `doctor` all say so. |
| How do I get publisher verification | Use the signed-release install, which verifies every byte against an Ed25519 signature and an operator-owned trust file before any code in the package runs. |

[Provenance](docs/provenance.md#unsigned-preview) states exactly what the unsigned preview does and does not guarantee, and how to move to the signed path.

## Phase 1 scope

Deployments are simulated by the `sandbox` provider. LocalStack and AWS are planned; nothing here creates cloud infrastructure or spends money. Version 1 of the connector remains a read-only reader and is configured separately; version 2, the reviewed-operations path this page describes, needs the companion Zenith control backend and exposes up to 24 scoped tools — thirteen reads plus exact proposal preparation, browser-approved execution, durable operation tracking, revisions and comparisons, scoped logs, incident bundles, app status and curated edit-field discovery.

## Documentation

[Installation](docs/installation.md) · [Configuration](docs/configuration.md) · [Version 2 setup and security](docs/control-v2.md) · [Tool reference](docs/tool-reference.md) · [Provenance](docs/provenance.md) · [Verification](docs/verification.md) · [Release process](docs/releases.md) · [Remaining scope](docs/roadmap.md)

## Development

```bash
npm ci --ignore-scripts
npm run verify
npm run contracts:check -- --backend /absolute/path/to/zenith
```

The TypeScript client and the v2 runtime are strict-checked. `plugins/` is generated: change `shared/` or `packages/` and run `npm run build`, never edit a generated file. Both packages ship their own runtime bundles and dependency notices, so installing one needs no compiler and no dependency install.

### Repository layout

Companion to **[GODOSTROYER/zenith](https://github.com/GODOSTROYER/zenith)**: Zenith owns the authenticated endpoint, actions, permissions and storage; this repository owns the client, the local stdio process and the shared skills.

| Path | What is in it |
| --- | --- |
| `packages/client` | the typed transport client and the versioned v2 control tool inventory |
| `packages/control` | the v2 runtime: stdio server, `login` / `logout` / `status`, profiles, credential vaults, source packaging |
| `packages/bridge` | the `login`, `setup`, `doctor`, `profile`, `source` and `stdio` commands |
| `packages/launcher` | `zenith-plugin-launcher`, which activates a verified private copy of a signed release |
| `packages/provenance` | the signing and verification primitives behind that gate |
| `shared/skills` | the twelve workflow skills both plugins are generated from |
| `plugins/claude-code`, `plugins/codex` | the generated packages, committed so installing one needs no compiler |
| `contracts/control-v2.json` | the snapshot `npm run contracts:check` holds the backend to |
| `tests` | the `node --test` suites for everything above |

## Boundaries

Zenith owns authentication, authorisation, actions and persistence. The plugin never opens Zenith's stores or impersonates Navigator. On tryzenith.cloud, reviewed writes run on the hosted PostgreSQL control plane; a self-hosted Zenith needs either that control plane or a long-lived single-writer file-store host, and refuses writes otherwise. Every write is a proposal approved in the browser; the agent cannot approve its own. Remote OAuth with your own authorisation provider remains available as an alternative to `login`. No project license grant has been selected.
