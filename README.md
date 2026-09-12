# Zenith integrations

**Your stack, clearly in view. In the tools where you build.**

One connection to Zenith. A standalone MCP bridge. Two native plugin packages for Codex and Claude Code, generated from the same implementation and workflow sources.

> **Development foundation · `0.1.0-dev.1`**
>
> This increment provides a read-only client, packaged launchers, and inspection workflows. The companion Zenith endpoint is an unmerged integration candidate. Execution, trusted approvals, persistent operation receipts, source publishing, and remote OAuth are **not implemented here**. This is not the completed integration product or a production-ready release.

## Start here

| Your goal | Read |
| --- | --- |
| Connect a development install | [Installation](docs/installation.md) |
| Understand configuration and credential handling | [Configuration](docs/configuration.md) |
| See exactly which tools are included | [Capabilities](docs/capabilities.md) |
| Review the implementation boundaries | [Architecture](docs/architecture.md) |
| Evaluate safety and deployment limits | [Security](docs/security.md) |
| Inspect what actually passed | [Verification](docs/verification.md) |
| Continue toward the complete product | [Remaining work](docs/roadmap.md) |

## One implementation, two packages

```text
Codex plugin          Claude Code plugin         Standalone MCP client
      \                     |                         /
       +--------------------+------------------------+
                            |
                     Local stdio bridge
                            |
                Authenticated, bounded HTTP
                            |
                  Zenith's own server process
                            |
                Permissions · actions · providers
```

This repository owns transport, installation, and workflow knowledge. [GODOSTROYER/zenith](https://github.com/GODOSTROYER/zenith) owns manifests, permissions, operational behavior, and data. No plugin opens a Zenith database, impersonates Navigator, or performs an extra model call to execute a tool.

## What this draft can do

Inspect explicit project and environment selections; retrieve redacted manifests and deployment metadata; request non-executable deployment previews; inspect stored findings and provider drift; generate redacted exports. A credential controls which reads, previews, and exports are exposed.

The bridge denies writes even when a connected server accidentally advertises them. A deployment preview is not an approval, a durable receipt, or proof that anything was deployed.

## Development

```bash
npm ci --ignore-scripts
npm run verify
```

Node 22.16 or later is required. TypeScript is pinned to 5.8.3. Runtime packages have no third-party dependencies and need no installation hook. Both plugin directories include their own runtime and skills.

The local evidence is **29 passing tests**, strict client typechecking, package generation, and layout/link checks. The tests use a real stdio subprocess and an HTTP fixture, not a running Zenith app or native agent clients. Registry installation was blocked in the build environment; the exact pinned compiler was already installed. [Read the complete evidence and limits](docs/verification.md).

## Repository map

```text
packages/client/         Typed, bounded API transport
packages/bridge/         Stdio launcher and diagnostics
shared/skills/           Canonical inspect and preview workflows
plugins/codex/           Generated, self-contained package
plugins/claude-code/     Generated, self-contained package
scripts/                Deterministic packaging and local checks
tests/                  Transport, credential, and packaged-process tests
docs/                   Installation, contracts, design, and evidence
```

No packages have been published and no production infrastructure is deployed by this repository. There is no project license grant yet; dependency licenses are independent. Review branches must not be merged or published without explicit approval.
