# Zenith integrations

**Your stack, clearly in view. In the tools where you build.**

One standalone MCP bridge and two self-contained native plugin packages, generated from shared transport and workflow sources.

> **Development increment · `0.1.0-dev.2`**
>
> Inspection, non-executable previews, redacted exports, private connection setup and diagnostics. No deployment execution, trusted approvals, durable write receipts, source publishing or remote OAuth. This is not a production-ready integration.

## Connect and develop

Maintainers:

```bash
npm ci --ignore-scripts
npm run verify
```

Node 22.16 or later; TypeScript pinned to 5.8.3. Generated packages need no runtime dependency installation. [Installation](docs/installation.md) covers the required Zenith reader, operator-issued credentials, standalone MCP, Codex and Claude Code.

With an existing scoped credential, create a new private profile outside the checkout:

```bash
npm run setup -- --output "$HOME/.config/zenith-reader/profile.json" \
  --url http://127.0.0.1:3400 --allow-loopback-http \
  --workspace WORKSPACE_ID --project PROJECT_ID \
  --token-file "$HOME/.config/zenith-reader/client.token"
export ZENITH_CONFIG_FILE="$HOME/.config/zenith-reader/profile.json"
npm run doctor
```

Setup validates local configuration only; it neither issues credentials nor connects. Doctor authenticates and checks the selected scope and capability contract, not provider health. Profiles/private token files require verified POSIX permissions; Windows currently uses explicit environment configuration. [Configuration and diagnostics](docs/configuration.md).

## Ownership and capability boundaries

```text
Codex plugin       Claude Code plugin       Standalone MCP
      \                  |                       /
       +------------------+----------------------+
                          |
               Shared bounded stdio bridge
                          |
               Zenith /api/agent/v1/mcp
                          |
              Authorization · actions · stores
```

[GODOSTROYER/zenith](https://github.com/GODOSTROYER/zenith) owns operational logic, permissions and data. Its read-only agent endpoint is merged at `2d56ecc3abe77f560d9c58bee14370b0789f386a`. This increment needs no additional backend change, but the reader remains opt-in and loopback-development only.

The bridge exposes 13 curated read/preview/export tools and five shared skills: connect, inspect, plan, observe and export. It refuses writes even if a newer server advertises them. It never opens Zenith storage, impersonates Navigator or calls another model to execute a tool. [Tool reference](docs/capabilities.md).

## Evidence and continuation

Local Linux verification: **92 tests passed**, strict client typecheck, source syntax checks, package generation and complete runtime/skill integrity checks. The tests include copied-package stdio/HTTP fixtures, setup, credential rotation, cancellation and reproducible npm archives. They are **not** real Zenith, native Codex/Claude, OAuth or provider tests. A clean npm registry install remains unverified locally because of DNS restrictions. [Exact evidence](docs/verification.md).

```bash
npm run release:prepare  # local review archives and checksums; never publishes
npm run test:live        # requires ZENITH_LIVE_TEST=1 and a real configured Zenith
```

[Architecture](docs/architecture.md) · [Security](docs/security.md) · [Implementation status](docs/implementation-status.md) · [Release gates](docs/roadmap.md)

```text
packages/client/         Typed, bounded HTTP transport and contract checks
packages/bridge/         Stdio lifecycle, private setup and doctor
shared/skills/           Canonical workflow sources
plugins/codex/           Generated self-contained package
plugins/claude-code/     Generated self-contained package
scripts/                Build, integrity, local artifacts and opt-in live checks
tests/                  Unit, protocol, setup, HTTP fixture and archive tests
docs/                   Setup, contracts, decisions and verification evidence
```

No packages are published and no infrastructure is deployed by this repository. There is no project license grant yet; dependency licenses are independent. Do not merge or publish without explicit authorization.
