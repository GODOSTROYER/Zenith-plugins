# Installation

[Home](../README.md) · [Configuration](configuration.md) · [Troubleshooting](configuration.md#troubleshooting)

## Before you begin

This is a development install, not a public service. You need access to both repositories, Node 22.16 or later, a reviewed companion Zenith checkout, and an actual non-demo workspace member. The `local`, `navigator`, and `system` identities cannot receive reader credentials.

The application base inspected for the companion is `70d9c4a610b96f3d45bed0d85bd4155bbbf295f7`. Do not assume unmodified Zenith exposes the new endpoint. Keep the companion on an isolated branch and use disposable development data. The full application integration has not yet been run end to end.

## 1. Prepare the distribution checkout

```bash
git clone git@github.com:GODOSTROYER/Zenith-plugins.git
cd Zenith-plugins
git switch feat/connector-foundation
npm ci --ignore-scripts
npm run verify
```

The generated `plugins/` directories are committed. A user installing those directories does not need npm or the compiler at runtime; maintainers need them to reproduce the packages.

## 2. Prepare Zenith's reader authority

On the companion Zenith branch, the operator creates a private directory outside both repositories and issues a short-lived credential. The command belongs to the operator, never to an MCP tool.

```bash
mkdir -p "$HOME/.config/zenith-reader"
chmod 700 "$HOME/.config/zenith-reader"
node scripts/agent-credential.mjs issue \
  --file "$HOME/.config/zenith-reader/access.credentials.json" \
  --subject USER_ID \
  --workspace WORKSPACE_ID \
  --projects PROJECT_ID \
  --scopes read,plan,export \
  --days 1 \
  --token-out "$HOME/.config/zenith-reader/client.token"
```

Replace uppercase identifiers with actual authorized IDs. The server independently verifies workspace membership and record ownership; issuance itself does not create membership. The utility prints the credential ID, not its secret. Keep that ID for revocation. `read` alone is the default; omit optional scopes unless needed.

Configure the **server process**:

```bash
export ZENITH_AGENT_READER=1
export ZENITH_AGENT_ORIGIN=http://127.0.0.1:3400
export ZENITH_AGENT_CREDENTIAL_FILE="$HOME/.config/zenith-reader/access.credentials.json"
npm run dev -- --hostname 127.0.0.1
```

**Bind the server to loopback.** An origin/Host check is not a firewall and does not prove the caller is local. Do not place a reverse proxy, tunnel, or public listener in front of this development endpoint. Public/remote OAuth is a separate unfinished capability.

## 3. Configure the client process

```bash
export ZENITH_URL=http://127.0.0.1:3400
export ZENITH_ALLOW_LOOPBACK_HTTP=1
export ZENITH_WORKSPACE_ID=WORKSPACE_ID
export ZENITH_PROJECT_ID=PROJECT_ID
export ZENITH_TOKEN_FILE="$HOME/.config/zenith-reader/client.token"
node packages/bridge/cli.mjs doctor
```

Set these in a trusted user environment, not a project `.env` file, prompt, skill, or committed manifest. Native clients must inherit this environment; a desktop process may not inherit variables from an unrelated terminal. `doctor` verifies authenticated initialization and tool discovery only. It does not certify provider health or deployment success.

## 4. Choose a client

### Standalone MCP

Register `node` as the executable and these arguments in your MCP client's settings:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/Zenith-plugins/packages/bridge/cli.mjs", "stdio"]
}
```

The settings wrapper varies by client. The command is also a direct development entry point; without an MCP client it waits for line-delimited JSON-RPC on stdin.

### Claude Code development package

```bash
claude --plugin-dir /absolute/path/to/Zenith-plugins/plugins/claude-code
```

The package uses `${CLAUDE_PLUGIN_ROOT}` internally and provides `inspect` and `plan` skills. The included `.claude-plugin/marketplace.json` is for repository-backed distribution. Native installation and skill invocation have not been exercised in this environment; manually validate them before marking compatibility supported.

### Codex development package

The repository's `.agents/plugins/marketplace.json` points to `plugins/codex`. Use the installed client's `/plugins` marketplace workflow against this checkout. The package uses an unwrapped MCP server map and `${PLUGIN_ROOT}` for its executable path.

The manifest is a development candidate, not a claim that every Codex surface accepts it. Verify root expansion, environment inheritance, skill discovery and tool calls in the exact CLI version intended for release. A direct MCP registration remains available independently of the native plugin format.

## Upgrade and uninstall

Review changes in both repositories, pin compatible commits, rebuild with the lockfile, rerun verification, and replace the entire generated plugin directory. Do not copy only a launcher and leave an older client beside it. Restart/reload the native client according to its own installation behavior.

To remove access, **revoke the server credential first**:

```bash
node scripts/agent-credential.mjs revoke \
  --file "$HOME/.config/zenith-reader/access.credentials.json" \
  --id CREDENTIAL_ID
```

Then uninstall the plugin or remove its standalone MCP registration, delete your client token file, and unset client configuration. Uninstalling a plugin alone does not revoke a credential. Nothing here deletes a Zenith project or tears down infrastructure.
