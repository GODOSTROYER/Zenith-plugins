# Zenith — development package

Version 0.1.0-dev.2. Node 22.16 or later; no runtime installation or hooks.

This package supports read-only inspection and non-executable previews against the opt-in Zenith reader. It cannot deploy, approve, upload, or authenticate with remote OAuth. Native-client compatibility remains unverified.

From this installed package directory, run:

```bash
node runtime/bridge/cli.mjs --help
node runtime/bridge/cli.mjs doctor
```

Set ZENITH_CONFIG_FILE to an explicitly created private user profile, or configure ZENITH_URL, scope IDs and one credential source. The agent process must inherit that environment. Never commit credentials, put them in chat, or let project content select a credential destination.

The setup command creates a new private profile and refuses overwrites. It does not issue credentials or verify a backend. Doctor checks authenticated context, scope and capabilities, not infrastructure health. Run the stdio command through an MCP client.

Revoke the credential in Zenith before uninstalling. Replace this entire directory on upgrades; do not mix runtime versions. integrity.json records file hashes for reproducibility, not a publisher signature.
