# Installation

[Home](../README.md) · [Configuration](configuration.md) · [Control v2](control-v2.md) · [Verification](verification.md) · [Provenance](provenance.md)

Two install shapes exist and they have different trust properties. Read this paragraph before choosing.

- **Source install (§1)** is the supported public path for phase 1. You clone this repository and run the connector from the checkout. Its trust root is *"you cloned the repository you meant to clone"* — the same trust root any `npx`-less GitHub install has. No manifest and no launcher are needed, because `enforceInstalledProvenance()` computes `isInstalledRuntime` from the module's own location and a checkout's copy does not sit under `<package>/runtime/provenance`.
- **Signed release with the trusted launcher (§2)** is optional for a development install and **required** for the generated packages under `plugins/`, whose runtime does sit under `runtime/`, so their activation gate is always on — `ZENITH_REQUIRE_PROVENANCE=0` cannot disable it. That path is not one click today: install the launcher, fetch the package envelope, set two absolute paths, then use. That is the cost of a gate that cannot be turned off on a package which can dispatch deployments, and it is the right default.

Do not weaken either. If you want the gate on a source install too, set `ZENITH_REQUIRE_PROVENANCE=1`.

## Prerequisites

Node 22.16 or later, a real non-demo Zenith workspace member, and a Zenith instance with the v2 control backend enabled. Phase 1 deployments are simulated by the `sandbox` provider; LocalStack and AWS are not enabled.

## 1. Source install and browser link — phase 1

```bash
git clone https://github.com/GODOSTROYER/Zenith-plugins.git
cd Zenith-plugins && npm ci --ignore-scripts
```

> The repository is private today. A public one-line install needs the repository to be public, or a reader token on the clone; that visibility decision belongs to the operator, not to this document.

Link the connector to a Zenith account. The command prints a URL and a code, opens a browser when it can, and waits:

```bash
ZENITH_API_VERSION=2 node packages/bridge/cli.mjs login
# or, for a different instance:
ZENITH_API_VERSION=2 node packages/bridge/cli.mjs login --url https://your-zenith-host
```

```
Zenith link

  1. Open   https://tryzenith.cloud/agent/link?code=K7QM-3XRB
  2. Check the code shown there matches:   K7QM-3XRB
  3. Sign in, choose the workspace and projects, and approve.

Waiting for approval (expires in 10 minutes). Press Ctrl-C to stop.
```

Sign in, confirm the code matches the one in the terminal, choose the workspace, the projects and the scopes, and approve. The connector stores the issued credential and prints what was granted. The credential is never printed, and the device code never leaves the process.

`login` defaults to `https://tryzenith.cloud`; `--url`, then `ZENITH_URL`, override it. Writes are enabled locally when — and only when — the browser granted `write` or `publish`; there is no second local flag to set. Approving a link deploys nothing: every change the agent proposes later is reviewed again in the browser before it runs.

Where the credential goes, by platform:

| platform | destination | profile |
| --- | --- | --- |
| Linux / macOS | `~/.config/zenith/<name>.token`, mode 0600, beside `~/.config/zenith/profiles.json` | written |
| macOS with `--keychain` | login Keychain item | written, holding the service/account reference only |
| Windows | `%LOCALAPPDATA%\ZenithPrivate\<name>.dpapi` (CurrentUser DPAPI) | **not written** |

Named profile files are POSIX-only in this build, because the private-file ACL validation a Windows profile would need does not exist yet. On Windows `login` prints the exact environment block to set instead, and `--json` emits the same data for a wrapper to consume. Vault paths are create-only: a second `login` for the same name refuses rather than replacing a credential.

Then check and use it:

```bash
export ZENITH_API_VERSION=2
export ZENITH_PROFILES_FILE="$HOME/.config/zenith/profiles.json"   # POSIX; Windows uses the printed block
node packages/bridge/cli.mjs status
```

`status` reports the origin, the profile, the linked account label, the granted scopes, the expiry and the backend's capability report. It verifies authentication and scope, not provider health and not a deployment. `logout` removes the local credential and nothing else — revoke at `ORIGIN/integrations` → **Linked agents**.

### Register it with a client

Standalone MCP, or any client that takes a command:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/Zenith-plugins/packages/bridge/cli.mjs", "stdio"],
  "env": { "ZENITH_API_VERSION": "2", "ZENITH_PROFILES_FILE": "/absolute/private/profiles.json" }
}
```

Claude Code, from the checkout:

```bash
claude --plugin-dir /absolute/path/to/Zenith-plugins/plugins/claude-code
claude plugin validate /absolute/path/to/Zenith-plugins/plugins/claude-code --strict
```

Or through the repository marketplace:

```bash
/plugin marketplace add GODOSTROYER/Zenith-plugins
/plugin install zenith@zenith
```

Codex: the repository marketplace `.agents/plugins/marketplace.json` selects `plugins/codex` with `policy.authentication: "ON_INSTALL"`, which is what should trigger `zenith login`. Use the installed CLI's `/plugins` marketplace flow against the checkout:

```bash
codex
/plugins
# add the local marketplace at /absolute/path/to/Zenith-plugins, then install zenith
```

Both generated packages invoke `zenith-plugin-launcher`, so installing them from the marketplace also requires §2. Validate launcher discovery, `${PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}` interpolation, environment inheritance and the skill list in your exact CLI version; neither a layout check nor a copied Node subprocess establishes native compatibility. These are documented commands, **not commands executed in this build environment**.

The agent process must inherit the configuration. An unrelated desktop process may not inherit a terminal's environment; restart the client after changing it.

## 2. Signed release and the trusted launcher

Required for the generated packages, optional for a source install. Complete the fail-closed [publisher provenance gate](provenance.md) before extracting or registering either package. The committed development packages carry hash inventories only, which are not a publisher signature.

The launcher is this repository's only `bin`, so install it from a verified checkout or archive, outside the plugin directory:

```bash
npm install -g "$PWD"
command -v zenith-plugin-launcher
```

Then set the two absolute provenance variables in the environment the MCP client passes to the server, using the **package** envelope for the directory being activated:

```bash
export ZENITH_PROVENANCE_MANIFEST=/absolute/path/zenith-codex-VERSION.package-manifest.json
export ZENITH_PROVENANCE_TRUST=/absolute/path/trusted-keys.json
```

A release manifest is refused here with `subject_mismatch`. Inside an installed package, `node runtime/bridge/cli.mjs --help` and `--version` still run with no provenance inputs; `login`, `logout`, `status`, `doctor`, `stdio`, `setup` and the rest of the v2 control commands exit 1 with `provenance_required` until both variables are set. Run them through the launcher:

```bash
zenith-plugin-launcher --package-dir /absolute/path/to/package --entry runtime/bridge/cli.mjs login
```

Making a marketplace install one click would mean publishing signed releases on a schedule and publishing `trusted-keys.json` with a fingerprint the README carries — a key-management commitment (custody, rotation, revocation), not a code change. Nobody should sign up for it implicitly.

`npm run release:prepare` verifies the checkout and writes both npm `.tgz` review archives, `release.json` and `SHA256SUMS` under ignored `artifacts/`; its output is labelled unsigned. `npm run release:sign -- --key-id ID --private-key ABSOLUTE_FILE --trust ABSOLUTE_FILE` additionally writes and re-verifies the release and per-package envelopes. Neither publishes a package or creates a GitHub release, and neither will sign in CI.

## 3. Version 1 reader — legacy

> **Legacy version-1 reference.** The rest of this page describes the retained read-only v1 reader. For current operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

The reader is merged in Zenith `master` at `2d56ecc3abe77f560d9c58bee14370b0789f386a`; earlier default branches may lack it. Use isolated development data and loopback binding.

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

Bind to loopback. Host/Origin validation is not a firewall. Do not add a public proxy or tunnel.

Back in `Zenith-plugins`:

```bash
npm run setup -- --output "$HOME/.config/zenith-reader/profile.json" \
  --url http://127.0.0.1:3400 --allow-loopback-http \
  --workspace WORKSPACE_ID --project PROJECT_ID \
  --token-file "$HOME/.config/zenith-reader/client.token"
export ZENITH_CONFIG_FILE="$HOME/.config/zenith-reader/profile.json"
npm run doctor
```

Unset old individual connection variables first. Setup refuses existing destinations and never issues credentials. [Configuration](configuration.md) documents explicit environment fallback, ID-only associations, Windows restrictions and troubleshooting.

## Upgrade and uninstall

**Breaking change when upgrading from a pre-provenance package.** The generated `.mcp.json` invokes `zenith-plugin-launcher` instead of `node`. An existing registration keeps pointing at `node` and must be replaced; a new one fails with the MCP client's "command not found" until the launcher is installed as described in §2.

Pin compatible server/client revisions and review changes. Rebuild using the lockfile and replace the entire generated package, not individual runtime files. Restart/reload the agent according to its client behavior.

**Revoke before uninstalling.** For a browser-linked credential, revoke it at `ORIGIN/integrations` → **Linked agents**; `zenith logout` only removes the local copy. For a v1 operator-issued credential:

```bash
node scripts/agent-credential.mjs revoke \
  --file "$HOME/.config/zenith-reader/access.credentials.json" \
  --id CREDENTIAL_ID
```

Then remove the plugin or MCP registration, delete the client token/profile and unset configuration. Uninstall alone does not revoke authority. Nothing in this process deletes a project or tears down infrastructure.
