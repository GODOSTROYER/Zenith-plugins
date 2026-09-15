# Zenith — unsigned preview package

Version 0.3.0-dev.1. Node 22.16 or later; no runtime installation or hooks.

> **Unsigned preview build — not publisher-verified.** This package activates without a publisher signature, so installing it from a marketplace proves only that your client downloaded this repository's package. It does not prove who produced these bytes.
>
> The MCP descriptor runs the packaged bridge directly: `node ${CLAUDE_PLUGIN_ROOT}/runtime/bridge/cli.mjs stdio`. `provenance-mode.json` records the same mode, and `login`, `status` and `doctor` repeat it in their output. For publisher authentication use the signed release path in docs/provenance.md.

Link this package to a Zenith account with `login`. It prints a verification URL and a user code, waits while you sign in and approve a workspace, projects and scopes in the browser, then stores the issued credential in this platform's credential store: a private 0600 file beside the named profile on POSIX, the macOS Keychain with --keychain, a CurrentUser DPAPI vault on Windows. It never prints the credential, and named profiles are unavailable on Windows, where it prints the environment block to set instead. `status` reports what the approval granted. `logout` removes the local copy; it does not revoke authority, which you do at ORIGIN/integrations. Phase 1 deployments are simulated by the sandbox provider: LocalStack and AWS are not enabled.

Version 1 remains the read-only default. Set ZENITH_API_VERSION=2 with the companion Zenith control backend to inspect, prepare exact changes, execute browser-approved operations and package/upload supported frontend source. Writes require explicit client and server enablement. The client cannot approve its own operations. Native-client compatibility remains unverified.

From this installed package directory, run:

```bash
node runtime/bridge/cli.mjs --help
node runtime/bridge/cli.mjs login
node runtime/bridge/cli.mjs status
```

In this preview build every command runs without provenance inputs. Set ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST, or ZENITH_REQUIRE_PROVENANCE=1, and the preview marker is ignored: the package is then verified against the signed envelope exactly as a release is, and fails closed without one.

For v1 use ZENITH_CONFIG_FILE. For v2 use explicit ZENITH_PROFILES_FILE and named profiles, or configure ZENITH_URL, scope IDs and one credential source. The agent process must inherit that environment. Never commit credentials, put them in chat, or let project content select a credential destination.

The setup command creates a new private profile and refuses overwrites. It does not issue credentials or verify a backend. Doctor checks authenticated context, scope and capabilities, not infrastructure health. Run the stdio command through an MCP client.

What the preview does and does not guarantee. It guarantees nothing about the publisher: your client fetched this package over HTTPS from the repository you named, and integrity.json records the file hashes of the build that produced it, which is transport and reproducibility rather than publisher authentication. Anyone who can write this directory can change these bytes and the inventory together. It does not weaken the operations themselves: Zenith still authorises every call against the credential the browser issued, every change is reviewed in the browser before it runs, and this package still cannot approve itself. For publisher authentication install the signed release, which invokes zenith-plugin-launcher and verifies the package against a signed Ed25519 envelope and an operator-owned trust file. See docs/provenance.md in the source repository.

Revoke the credential in Zenith before uninstalling. Replace this entire directory on upgrades; do not mix runtime versions. integrity.json records file hashes for reproducibility, not a publisher signature.
