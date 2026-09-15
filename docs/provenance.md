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

The signed envelope covers its algorithm, key ID, signing time, expiry, and manifest. Key rotation requires distributing the new public key through the operator's trusted configuration channel. Mark an old key `revoked` after migration; a valid old signature is then rejected. No trust key is embedded in this repository, and the repository does not silently alter Codex/Claude marketplace behavior or publish artifacts.
