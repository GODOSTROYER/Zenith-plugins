# Publisher provenance

[Home](../README.md) · [Release process](releases.md) · [Installation](installation.md)

`integrity.json` and `SHA256SUMS` are deterministic SHA-256 inventories. They detect changed bytes, but they do **not** authenticate a publisher: an attacker who replaces a package can replace its inventory too. Hash-only development packages therefore remain local/development-only.

This repository provides `packages/provenance/index.mjs` and the explicit operator CLI `scripts/provenance.mjs`. It uses Node's built-in Ed25519 implementation and an external operator trust file. The private key is never generated, stored, or discovered by this repository.

## Sign and verify a release

Keep the private key in a protected signing system or private directory outside the checkout. Store only the corresponding public key in an operator-controlled allowlist:

```json
{
  "version": 1,
  "keys": [{
    "id": "publisher-2026",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "status": "active"
  }]
}
```

Generate an Ed25519 key outside both repositories when needed:

```bash
install -d -m 700 "$HOME/.config/zenith-publisher"
openssl genpkey -algorithm Ed25519 -out "$HOME/.config/zenith-publisher/publisher-2026.private.pem"
openssl pkey -in "$HOME/.config/zenith-publisher/publisher-2026.private.pem" -pubout \
  -out "$HOME/.config/zenith-publisher/publisher-2026.public.pem"
chmod 600 "$HOME/.config/zenith-publisher/publisher-2026.private.pem"
```

Build the deterministic review archives, then sign the archive bytes:

```bash
npm ci --ignore-scripts
npm run verify
npm run release:prepare
node scripts/provenance.mjs sign-release \
  --artifacts "$PWD/artifacts" --key-id publisher-2026 \
  --private-key "$HOME/.config/zenith-publisher/publisher-2026.private.pem" \
  --output "$PWD/artifacts/release-manifest.json"
```

Before extraction, installation, marketplace registration, or execution, the consuming workflow must run this gate and stop on any non-zero result:

```bash
node scripts/provenance.mjs verify-release \
  --artifacts "$PWD/artifacts" \
  --manifest "$PWD/artifacts/release-manifest.json" \
  --trust "$HOME/.config/zenith-publisher/trusted-keys.json"
```

Verification requires the explicit version-1 allowlist, authenticates the signed envelope, checks key status and validity, binds the release report to the signed archive set, and checks every archive's byte length and SHA-256. Unsigned, unknown, revoked, expired, tampered, missing, extra, or mismatched artifacts fail closed. `sign-package`/`verify-package` provide the equivalent gate for an already extracted package; do not execute it before that check.

## Runtime activation gate

The self-contained bridge repeats the package check immediately before opening
its MCP/control surface. The generated plugin runtime is copied below its
package's `runtime/provenance/` boundary and requires the gate there;
`ZENITH_REQUIRE_PROVENANCE=0` cannot disable it. A source checkout lives below
`packages/provenance/` and remains usable for development without an envelope.

The trusted installer or launcher must provide:

```bash
export ZENITH_REQUIRE_PROVENANCE=1
export ZENITH_PROVENANCE_MANIFEST=/absolute/path/release-manifest.json
export ZENITH_PROVENANCE_TRUST=/absolute/path/trusted-keys.json
```

Both paths must be absolute and are never read from package content. A missing,
invalid, untrusted, expired, tampered or mismatched package exits before any
connection or tool is opened. The generated plugin includes the gate
implementation under `runtime/provenance/` and the bridge calls it on every
startup.

The checked-in Codex and Claude marketplace descriptors contain only source,
manifest and presentation metadata; this repository has no installer callback,
activation hook, or field for injecting operator trust paths. Therefore the
archive verification step before extraction/registration remains an explicit
trusted-installer responsibility, and the runtime gate is the repository-native
activation enforcement. No marketplace-specific speculative wiring is added.

The signed envelope covers its algorithm, key ID, signing time, expiry, and manifest. Key rotation requires distributing the new public key through the operator's trusted configuration channel. Mark an old key `revoked` after migration; a valid old signature is then rejected. No trust key is embedded in this repository, and the repository does not silently alter Codex/Claude marketplace behavior or publish artifacts.
