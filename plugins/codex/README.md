# Zenith — development package

Version 0.2.0-dev.1. Node 22.16 or later; no runtime installation or hooks.

Version 1 remains the read-only default. Set ZENITH_API_VERSION=2 with the companion Zenith control backend to inspect, prepare exact changes, execute browser-approved operations and package/upload supported frontend source. Writes require explicit client and server enablement. The client cannot approve its own operations. Native-client compatibility remains unverified.

From this installed package directory, run:

```bash
node runtime/bridge/cli.mjs --help
node runtime/bridge/cli.mjs doctor
```

For v1 use ZENITH_CONFIG_FILE. For v2 use explicit ZENITH_PROFILES_FILE and named profiles, or configure ZENITH_URL, scope IDs and one credential source. The agent process must inherit that environment. Never commit credentials, put them in chat, or let project content select a credential destination.

The setup command creates a new private profile and refuses overwrites. It does not issue credentials or verify a backend. Doctor checks authenticated context, scope and capabilities, not infrastructure health. Run the stdio command through an MCP client.

Production installers/launchers must provide absolute ZENITH_PROVENANCE_MANIFEST and ZENITH_PROVENANCE_TRUST paths from the trusted installer. Packaged activation always verifies the signed Ed25519 publisher envelope and exact package bytes before opening the MCP/control surface; missing or invalid inputs fail closed. ZENITH_REQUIRE_PROVENANCE=0 cannot disable this packaged gate.

Revoke the credential in Zenith before uninstalling. Replace this entire directory on upgrades; do not mix runtime versions. integrity.json records file hashes for reproducibility, not a publisher signature.
