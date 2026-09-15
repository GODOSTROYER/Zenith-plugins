> **Legacy version-1 reference.** These restrictions and commands describe the retained v1 reader. For current v2 operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

# Installation

[Home](../README.md) · [Configuration](configuration.md) · [Verification](verification.md)

For an operator-authenticated release, complete the fail-closed [publisher provenance gate](provenance.md) before extracting or registering either package. The committed development packages contain hash inventories only and remain local/development-only.

## Prerequisites

Access to both repositories, Node 22.16 or later and a real non-demo Zenith workspace member are required. The reader is merged in Zenith `master` at `2d56ecc3abe77f560d9c58bee14370b0789f386a`; earlier default branches may lack it. Use isolated development data and loopback binding. Full application/native-client integration remains unverified here.

```bash
git clone git@github.com:GODOSTROYER/Zenith-plugins.git
cd Zenith-plugins
# For an unmerged increment, switch to the PR branch you are reviewing.
npm ci --ignore-scripts
npm run verify
```

Generated plugin directories are committed. Installing those directories does not require the compiler or a runtime dependency installation. Production activation also requires the trusted `zenith-plugin-launcher` from `packages/launcher/cli.mjs` and its verifier to be installed outside the plugin directory; the launcher must be on PATH with the two absolute provenance environment variables set.

## 1. Issue authority in the Zenith checkout

Run as the operator in `GODOSTROYER/zenith`, not as an MCP tool:

```bash
mkdir -p "$HOME/.config/zenith-reader"
chmod 700 "$HOME/.config/zenith-reader"
node scripts/agent-credential.mjs issue \
  --file "$HOME/.config/zenith-reader/access.credentials.json" \
  --subject USER_ID --workspace WORKSPACE_ID --projects PROJECT_ID \
  --scopes read --days 1 \
  --token-out "$HOME/.config/zenith-reader/client.token"
```

Use actual permitted IDs. `local`, `navigator` and `system` identities cannot receive these credentials. Issuance does not create membership. Add `plan` or `export` only when needed; `read` is required. The utility prints a revocation ID, not the secret. Keep credentials outside both repositories.

Configure the server process:

```bash
export ZENITH_AGENT_READER=1
export ZENITH_AGENT_ORIGIN=http://127.0.0.1:3400
export ZENITH_AGENT_CREDENTIAL_FILE="$HOME/.config/zenith-reader/access.credentials.json"
npm run dev -- --hostname 127.0.0.1
```

Bind to loopback. Host/Origin validation is not a firewall. Do not add a public proxy or tunnel; remote OAuth remains unfinished.

## 2. Set up the distribution client

Back in `Zenith-plugins`:

```bash
npm run setup -- --output "$HOME/.config/zenith-reader/profile.json" \
  --url http://127.0.0.1:3400 --allow-loopback-http \
  --workspace WORKSPACE_ID --project PROJECT_ID \
  --token-file "$HOME/.config/zenith-reader/client.token"
export ZENITH_CONFIG_FILE="$HOME/.config/zenith-reader/profile.json"
npm run doctor
```

Unset old individual connection variables first. Setup refuses existing destinations and never issues credentials. Doctor verifies authentication/selected scope/capabilities, not provider health. [Configuration](configuration.md) documents explicit environment fallback, ID-only associations, Windows restrictions and troubleshooting. Native client processes must inherit the configuration; an unrelated desktop process may not inherit a terminal's environment.

## 3. Select a client

### Standalone MCP

Configure the following executable/arguments using your MCP client's settings wrapper:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/Zenith-plugins/packages/bridge/cli.mjs", "stdio"]
}
```

No plugin installation is required. Running the command directly waits for newline-delimited MCP messages on stdin.

### Claude Code

```bash
claude --plugin-dir /absolute/path/to/Zenith-plugins/plugins/claude-code
claude plugin validate /absolute/path/to/Zenith-plugins/plugins/claude-code --strict
```

The package uses `${CLAUDE_PLUGIN_ROOT}` and a `mcpServers` configuration wrapper. Its five skills are connect, inspect, plan, observe and export. The repository marketplace is `.claude-plugin/marketplace.json`. These are documented installation/validation commands, **not commands executed in this build environment**.

### Codex

The repository marketplace `.agents/plugins/marketplace.json` selects `plugins/codex`. Use the installed CLI's `/plugins` marketplace flow against the checkout. The package uses an unwrapped MCP server map and `${PLUGIN_ROOT}`, invoking the external `zenith-plugin-launcher`. Validate launcher discovery, interpolation, environment inheritance and skills/tools in your exact CLI version; neither a layout check nor a copied Node subprocess establishes native compatibility. Direct MCP configuration remains independent of plugin installation, but production direct invocation must still use the trusted launcher.

## Upgrade, artifacts and uninstall

Pin compatible server/client revisions and review changes. Rebuild using the lockfile and replace the entire generated package, not individual runtime files. Restart/reload the agent according to its client behavior. Dev.2 requires result contract 1 and rejects ambiguous connection configuration; follow the migration notes in [configuration](configuration.md).

`npm run release:prepare` verifies the checkout and writes both npm `.tgz` review archives, `release.json` and `SHA256SUMS` under ignored `artifacts/`. It does not publish packages or create a GitHub release. Sign `release.json`'s archive set separately, then run the [provenance verification gate](provenance.md) before consuming it. Hash inventories are not signatures; no public marketplace approval is implied.

**Revoke the credential in Zenith before uninstalling**:

```bash
node scripts/agent-credential.mjs revoke \
  --file "$HOME/.config/zenith-reader/access.credentials.json" \
  --id CREDENTIAL_ID
```

Then remove the plugin or MCP registration, delete the client token/profile and unset configuration. Uninstall alone does not revoke authority. Nothing in this process deletes a project or tears down infrastructure.
