# Installation

[Home](../README.md) · [Configuration](configuration.md) · [Control v2](control-v2.md) · [Verification](verification.md) · [Provenance](provenance.md)

Two install shapes exist and they have different trust properties. Read this paragraph before choosing.

- **Marketplace install (§1)** is the supported path for phase 1: two commands in your agent, then ask the agent to link your Zenith account. The generated packages are built as **unsigned previews** — they declare `"mode": "unsigned-preview"` in `provenance-mode.json`, their `.mcp.json` runs the packaged bridge directly with `node`, and the runtime gate accepts that declaration so nothing has to be configured by hand. In exchange, `login`, `status` and `doctor` all say the build is not publisher-verified. A marketplace fetch proves that your client downloaded this repository's package; it does not prove who produced the bytes. [Provenance](provenance.md#unsigned-preview) states exactly what that does and does not guarantee.
- **Signed release with the trusted launcher (§2)** is the production-grade install and is unchanged. The packages are rebuilt with `npm run build -- --signed`, which writes the descriptor that invokes `zenith-plugin-launcher` and the `signed-release` marker; the operator installs the launcher, fetches the package envelope and sets two absolute paths. The gate then verifies every byte against an Ed25519 signature before Node imports anything from the package, and `ZENITH_REQUIRE_PROVENANCE=0` cannot disable it.

The two are not a spectrum: setting `ZENITH_PROVENANCE_MANIFEST`, `ZENITH_PROVENANCE_TRUST` or `ZENITH_REQUIRE_PROVENANCE=1` on a preview package makes the preview marker irrelevant and the package is verified like a release — and fails closed without one. A source checkout (`git clone` + `npm ci`) needs neither, because `enforceInstalledProvenance()` computes `isInstalledRuntime` from the module's own location and a checkout's copy does not sit under `<package>/runtime/provenance`.

## Prerequisites

Node 22.16 or later, a Zenith account at [tryzenith.cloud](https://tryzenith.cloud) that is a real non-demo workspace member, and a Zenith instance with the v2 control backend enabled. Phase 1 deployments are simulated by the `sandbox` provider; LocalStack and AWS are not enabled.

## 1. Marketplace install and browser link — phase 1

**Claude Code** — two commands:

```
/plugin marketplace add GODOSTROYER/Zenith-plugins
/plugin install zenith@zenith
```

**Codex** — the same marketplace, from `.agents/plugins/marketplace.json`:

```
/plugins
# add the marketplace GODOSTROYER/Zenith-plugins (or a local checkout path), then install zenith
```

> The repository is private today, so both commands need the repository to be public or the client to be authenticated to it. Making it public is the owner's decision, not this document's.

Then **ask the agent to link your Zenith account** — "link my Zenith account", or run the `link` skill. The agent runs the connector's `login`, which prints a URL and a code and waits:

```
Zenith connector: unsigned preview build — not publisher-verified. …

Zenith link

  1. Open   https://tryzenith.cloud/agent/link?code=K7QM-3XRB
  2. Check the code shown there matches:   K7QM-3XRB
  3. Sign in, choose the workspace and projects, and approve.

Waiting for approval (expires in 10 minutes). Press Ctrl-C to stop.
```

The agent shows you the URL and the code; you open it, check the code matches, sign in and approve. Restart the plugin's MCP server afterwards (the server reads the credential at start-up) — in Claude Code, `/mcp` reconnect or a restart.

You can also run the same command yourself, from the installed package directory or a checkout:

```bash
node runtime/bridge/cli.mjs login                              # installed package
ZENITH_API_VERSION=2 node packages/bridge/cli.mjs login        # source checkout
ZENITH_API_VERSION=2 node packages/bridge/cli.mjs login --url https://your-zenith-host
```

The connector stores the issued credential and prints what was granted. The credential is never printed, and the device code never leaves the process — never type either into the conversation.

`login` defaults to `https://tryzenith.cloud`; `--url`, then `ZENITH_URL`, override it. Writes are enabled locally when — and only when — the browser granted `write` or `publish`; there is no second local flag to set. Approving a link deploys nothing: every change the agent proposes later is reviewed again in the browser before it runs.

Where the credential goes, by platform:

| platform | destination | profile |
| --- | --- | --- |
| Linux / macOS | `~/.config/zenith/<name>.token`, mode 0600, beside `~/.config/zenith/profiles.json` | written |
| macOS with `--keychain` | login Keychain item | written, holding the service/account reference only |
| Windows | `%LOCALAPPDATA%\ZenithPrivate\<name>.dpapi` (CurrentUser DPAPI) | **not written** |

Named profile files are POSIX-only in this build, because the private-file ACL validation a Windows profile would need does not exist yet. On Windows `login` prints the exact environment block to set instead, and `--json` emits the same data for a wrapper to consume. Vault paths are create-only: a second `login` for the same name refuses rather than replacing a credential.

On POSIX the connector then finds that profile on its own: with no explicit connection variable set, it reads `$XDG_CONFIG_HOME/zenith/profiles.json`, or `~/.config/zenith/profiles.json`, which is the file `login` just wrote. That is what lets a marketplace-installed server, started by the host from a committed descriptor, use a credential no descriptor could name. An explicit `ZENITH_PROFILES_FILE` always wins, and any explicit connection variable (`ZENITH_URL`, `ZENITH_TOKEN_FILE`, …) turns the default lookup off entirely. On Windows there is no default: use the environment block `login` printed.

Then check it:

```bash
node runtime/bridge/cli.mjs status                      # installed package
ZENITH_API_VERSION=2 node packages/bridge/cli.mjs status  # source checkout
```

`status` reports the activation mode, the origin, the profile, the linked account label, the granted scopes, the expiry and the backend's capability report. It verifies authentication and scope, not provider health and not a deployment. `logout` removes the local credential and nothing else — revoke at `ORIGIN/integrations` → **Linked agents**.

### Other ways to register the connector

A local checkout with Claude Code, without the marketplace:

```bash
claude --plugin-dir /absolute/path/to/Zenith-plugins/plugins/claude-code
claude plugin validate /absolute/path/to/Zenith-plugins/plugins/claude-code --strict
```

Any MCP client that takes a command:

```json
{
  "command": "node",
  "args": ["/absolute/path/to/Zenith-plugins/packages/bridge/cli.mjs", "stdio"],
  "env": { "ZENITH_API_VERSION": "2", "ZENITH_PROFILES_FILE": "/absolute/private/profiles.json" }
}
```

The generated packages' own descriptor is the preview form — `node ${CLAUDE_PLUGIN_ROOT}/runtime/bridge/cli.mjs stdio` (`${PLUGIN_ROOT}` for Codex) with `ZENITH_API_VERSION=2`. The Codex marketplace entry keeps `policy.authentication: "ON_INSTALL"`, which is what should trigger the link. Validate `${PLUGIN_ROOT}` / `${CLAUDE_PLUGIN_ROOT}` interpolation, environment inheritance and the skill list in your exact CLI version; neither a layout check nor a copied Node subprocess establishes native compatibility. These are documented commands, **not commands executed in this build environment**.

The agent process must inherit the configuration. An unrelated desktop process may not inherit a terminal's environment; restart the client after changing it.

## 2. Signed release and the trusted launcher — the production-grade install

The production path, unchanged by the phase-1 preview. Complete the fail-closed [publisher provenance gate](provenance.md) before extracting or registering either package. The committed development packages carry hash inventories only, which are not a publisher signature.

A signed release is built in the release shape first, so the descriptor the launcher binds to names the launcher:

```bash
npm run build:signed     # .mcp.json invokes zenith-plugin-launcher; provenance-mode.json says signed-release
npm run build            # restores the committed unsigned-preview shape afterwards
```

`npm run release:sign -- --key-id … --private-key … --trust …` runs the verify lane, then `build:signed`, then signs, so operators do not have to remember the order. Run `npm run build` when you are done to leave the checkout in its committed shape.

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

A release manifest is refused here with `subject_mismatch`. In a signed-release package — and in any package with no activation marker at all — `node runtime/bridge/cli.mjs --help` and `--version` still run with no provenance inputs, while `login`, `logout`, `status`, `doctor`, `stdio`, `setup` and the rest of the v2 control commands exit 1 with `provenance_required` until both variables are set. Run them through the launcher:

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

**The generated `.mcp.json` changed twice.** It moved from `node` to `zenith-plugin-launcher` when the provenance gate landed, and back to `node` for the phase-1 unsigned preview. A registration written by an older install keeps whichever command it captured: if a server fails to start with the client's "command not found", it is still pointing at `zenith-plugin-launcher`. Reinstall the plugin, or install the launcher as described in §2 and use the signed release.

Pin compatible server/client revisions and review changes. Rebuild using the lockfile and replace the entire generated package, not individual runtime files. Restart/reload the agent according to its client behavior.

**Revoke before uninstalling.** For a browser-linked credential, revoke it at `ORIGIN/integrations` → **Linked agents**; `zenith logout` only removes the local copy. For a v1 operator-issued credential:

```bash
node scripts/agent-credential.mjs revoke \
  --file "$HOME/.config/zenith-reader/access.credentials.json" \
  --id CREDENTIAL_ID
```

Then remove the plugin or MCP registration, delete the client token/profile and unset configuration. Uninstall alone does not revoke authority. Nothing in this process deletes a project or tears down infrastructure.
