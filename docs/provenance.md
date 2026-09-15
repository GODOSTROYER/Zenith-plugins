# Publisher provenance

[Home](../README.md) · [Release process](releases.md) · [Installation](installation.md)

`integrity.json` and `SHA256SUMS` are deterministic SHA-256 inventories. They detect changed bytes, but they do **not** authenticate a publisher: an attacker who replaces a package can replace its inventory too. Hash-only development packages therefore remain local/development-only.

This repository provides `packages/provenance/index.mjs`, the trusted launcher `packages/launcher/cli.mjs`, and the explicit operator CLI `scripts/provenance.mjs`. It uses Node's built-in Ed25519 implementation and an external operator trust file. The private key is never generated, stored, or discovered by this repository.

## What the gate proves, and what it does not

It proves that the bytes on disk in an installed package match a manifest signed by a key the operator put in a trust file, that the signature has not expired, that the key was valid when it signed, that the package has not been rolled back to an older signed version, and that the entry being launched is the entry the signed `.mcp.json` registers.

It does **not** prove how the package was registered. An MCP client reads its own server configuration before any code in this repository runs. If that configuration does not name `zenith-plugin-launcher`, nothing here is reached. **The host's MCP configuration is the trust root.** A trusted installer must own that file and point it at an absolute launcher path outside the package. The `.mcp.json` shipped inside each generated package is publisher content the launcher checks its own invocation against; it is not, and cannot be, the thing that makes the launcher run. See [the installer gap](#installer-and-marketplace-gap) below.

## Key custody

| Question | Answer |
| --- | --- |
| Who holds the private key | A named release operator, on a machine or HSM that is not a build agent. |
| Where it lives | An absolute path outside both repository checkouts, mode `0600`, in a `0700` directory. `scripts/release.mjs` refuses a `--private-key` path inside this checkout. |
| Who else can sign | Nobody. CI never signs: `scripts/release.mjs` refuses when `CI`, `GITHUB_ACTIONS`, `GITLAB_CI` or `BUILD_BUILDID` is set, and the attest workflow asserts it produced no publisher signature. |
| How the public key reaches consumers | Out of band, through the operator's own trusted configuration channel, into the operator-controlled trust file. No key is ever read from a package, a URL, or an environment default. |
| Where the trust file lives | An operator-owned absolute path, mode `0600`, in a directory the consuming user cannot write. The launcher refuses a world-writable trust file or a world-writable non-sticky parent directory where the platform reports POSIX modes; on Windows it reports the ACL check as unverified rather than claiming it passed. |

Generate an Ed25519 key outside both repositories when needed:

```bash
install -d -m 700 "$HOME/.config/zenith-publisher"
openssl genpkey -algorithm Ed25519 -out "$HOME/.config/zenith-publisher/publisher-2026.private.pem"
openssl pkey -in "$HOME/.config/zenith-publisher/publisher-2026.private.pem" -pubout \
  -out "$HOME/.config/zenith-publisher/publisher-2026.public.pem"
chmod 600 "$HOME/.config/zenith-publisher/publisher-2026.private.pem"
```

Store only the corresponding public key in an operator-controlled allowlist:

```json
{
  "version": 1,
  "keys": [{
    "id": "publisher-2026",
    "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----\n",
    "status": "active"
  }],
  "minimumVersions": { "zenith": "0.2.0-dev.1" }
}
```

`minimumVersions` is optional. It is the rollback floor an operator pins by hand, keyed by the signed subject's package name (`zenith`) or, for a release envelope, by its subject kind (`zenith-plugin-release`).

## Sign a release

Signing is a gated operator step. It requires a key path, a key id and the trust file to verify against; nothing is signed without all three.

```bash
npm ci --ignore-scripts
npm run release:sign -- \
  --key-id publisher-2026 \
  --private-key "$HOME/.config/zenith-publisher/publisher-2026.private.pem" \
  --trust "$HOME/.config/zenith-publisher/trusted-keys.json"
```

This runs the full verification lane, builds the deterministic review archives, then writes into `artifacts/`:

- `release-manifest.json` — the signed release envelope, binding `release.json` to the exact archive set with byte lengths and SHA-256 digests.
- `zenith-codex-VERSION.package-manifest.json` and `zenith-claude-code-VERSION.package-manifest.json` — the signed **package** envelopes, one per client, each binding every file of that installed package directory. These are the envelopes the runtime activation gate needs.

Both are re-verified before the command returns. `npm run release:prepare` produces the same archives unsigned and says so.

Every envelope carries an expiry; unbounded signatures are refused at both sign and verify. Without `--expires ISO` the signature expires 90 days after signing, and the command reports the instant it used.

## Verify a release before installing it

Before extraction, installation, marketplace registration, or execution, the consuming workflow must run this gate and stop on any non-zero result:

```bash
npm run provenance:verify -- \
  --artifacts "$PWD/artifacts" \
  --manifest "$PWD/artifacts/release-manifest.json" \
  --trust "$HOME/.config/zenith-publisher/trusted-keys.json"
```

Verification requires the explicit version-1 allowlist, authenticates the signed envelope, checks key status and validity, enforces expiry and any rollback floor, binds the release report to the signed archive set, and checks every archive's byte length and SHA-256. Unsigned, unknown, revoked, expired, tampered, missing, extra, or mismatched artifacts fail closed.

## Install the trusted launcher

The launcher must live outside every plugin package. Install it from a **verified** checkout or a verified archive, never from the copy under a package's `installer/` directory before that package has been verified:

```bash
# From a checkout whose release archives you have already verified above.
npm install -g "$PWD"
command -v zenith-plugin-launcher
```

If a global npm install is not acceptable, copy the two directories to an operator-owned absolute path instead, keeping them siblings — the launcher resolves its verifier as `../provenance/index.mjs`:

```bash
install -d -m 755 /opt/zenith/launcher /opt/zenith/provenance
install -m 755 packages/launcher/cli.mjs packages/launcher/state.mjs /opt/zenith/launcher/
install -m 755 packages/provenance/index.mjs packages/provenance/consumer.mjs /opt/zenith/provenance/
```

Then register the MCP server in the **host's own configuration file**, not in the package, pointing at that absolute path.

## Runtime activation gate

The generated plugin descriptor invokes `zenith-plugin-launcher`, which verifies the whole package before Node imports any package-owned module. The trusted installer or launcher wrapper must provide:

```bash
export ZENITH_PROVENANCE_MANIFEST=/absolute/path/zenith-codex-0.2.0-dev.1.package-manifest.json
export ZENITH_PROVENANCE_TRUST=/absolute/path/trusted-keys.json
```

`ZENITH_PROVENANCE_MANIFEST` must be a **package** envelope produced by `sign-package` (or by `npm run release:sign`, which writes one per client) for the exact directory being activated. A *release* manifest has subject kind `zenith-plugin-release` and is refused here with `subject_mismatch` on every activation. If you signed a package directory by hand, use:

```bash
node scripts/provenance.mjs sign-package \
  --package /absolute/path/to/installed/package --client codex \
  --key-id publisher-2026 \
  --private-key "$HOME/.config/zenith-publisher/publisher-2026.private.pem" \
  --output /absolute/path/zenith-codex.package-manifest.json
node scripts/provenance.mjs verify-package \
  --package /absolute/path/to/installed/package \
  --manifest /absolute/path/zenith-codex.package-manifest.json \
  --trust "$HOME/.config/zenith-publisher/trusted-keys.json"
```

Both variables must be absolute paths and are never read from package content. A missing, invalid, untrusted, expired, rolled-back, tampered or mismatched package exits before any connection or tool is opened.

Inside an installed package, `node runtime/bridge/cli.mjs --help` (also `-h` and `help`) and `--version` print static text and run without provenance inputs. Every other command — `doctor`, `stdio`, `setup` and the v2 control commands — is gated and fails closed with code `provenance_required` naming the missing variable. `ZENITH_REQUIRE_PROVENANCE=0` cannot disable the packaged gate.

The ungated commands are answered **before** the version-2 routing, not only before the gate. That routing keys off inherited environment — `ZENITH_API_VERSION=2` or `ZENITH_PROFILES_FILE` — so while help was printed after it, `--help` on an operator machine where either variable was already exported imported the whole control module graph (profiles, vault, keychain, remote) into a process the activation gate had deliberately not verified. It printed static text and opened nothing, so no credential was exposed, but the unverified import was real. `--help`, `-h`, `help` and `--version` now return before any control, profile or credential module is loaded, whatever the environment says.

### Verified bytes are the executed bytes

The launcher copies the package into a private temporary directory, verifies that copy, and spawns the entry from it. Verifying the installed directory and then executing from it leaves a window in which anyone who can write that directory swaps a file between hashing and `spawn`. Symlinks are copied verbatim rather than followed, so the inventory still refuses them. The copy is removed when the child exits.

The launcher also refuses an `--entry` that the package's signed `.mcp.json` does not register (`descriptor_mismatch`), so a tampered host registration cannot aim the launcher at some other signed file in the package.

### Rollback protection

A genuinely signed older package is still a downgrade. After each accepted activation the launcher records the subject and version in `zenith-provenance-state.json`, in the directory that holds `ZENITH_PROVENANCE_TRUST` (override with an absolute `ZENITH_PROVENANCE_STATE`). A later activation whose signed version is lower is refused with `version_rollback`.

Enforcement is unconditional. Recording is best effort, because a hardened operator may keep the trust directory read-only: a failed write is reported on stderr, and `ZENITH_PROVENANCE_STATE_REQUIRED=1` turns it into a refusal. In a read-only deployment, pin `minimumVersions` in the trust file instead — that floor is enforced by the verifier itself, in the launcher and in the in-process backstop alike.

Only an **absent** state file means "nothing recorded yet". Every other failure to read it — a permission denial, an I/O error, a path component that is not a directory — refuses activation with code `state_unreadable` rather than starting from no floor. This distinction is the difference between a first activation and a silently reset one: treating an unreadable floor as absent accepted a genuinely signed *older* package with exit 0 and no warning, which is exactly the downgrade the floor exists to stop. If the message names your own state path, repair or delete that file deliberately; deleting it is a conscious reset, and the next activation records the version it accepts.

The state file is itself a trust input, because whoever can delete it can re-enable that downgrade. Its default location is the `ZENITH_PROVENANCE_TRUST` directory, already checked when the trust file is read. An absolute `ZENITH_PROVENANCE_STATE` override is put through the **same** directory check: the directory must exist, and on POSIX it must not be world-writable without the sticky bit, or activation is refused with `unsafe_trust_path` naming `ZENITH_PROVENANCE_STATE`. As everywhere else in this document, Windows reports the permission half of that check as unverified rather than passing it — an override there emits a `state_permissions_unverified` warning on stderr, and the directory must be protected with an explicit ACL.

## Rotation

The code supports an overlap window through `notBefore`/`notAfter`, which are checked against the envelope's `signedAt`, not against the clock. A rotation therefore looks like this:

1. Generate `publisher-2027` on the operator machine. Distribute its public key through the trusted configuration channel and add it to every consumer's trust file **alongside** `publisher-2026`, both `active`.
2. Close the old key's window and open the new one, so each signature is judged against the key that was current when it was made:

```json
{
  "version": 1,
  "keys": [
    { "id": "publisher-2026", "publicKey": "...", "status": "active", "notAfter": "2027-01-01T00:00:00.000Z" },
    { "id": "publisher-2027", "publicKey": "...", "status": "active", "notBefore": "2026-12-01T00:00:00.000Z" }
  ]
}
```

3. Sign the next release with `publisher-2027` and let consumers upgrade during the overlap. Releases signed by `publisher-2026` before `notAfter` keep verifying.
4. When every consumer has upgraded, mark `publisher-2026` `"status": "revoked"`, or delete the entry.

## Revocation, and what it does not cover

Revocation is **key-level only**, and it is a static field in a file each consumer already holds:

- Marking a key `"status": "revoked"` (or setting `revokedAt`) makes every signature by that key fail with `revoked_key` — including signatures that were previously accepted.
- There is **no freshness requirement**. Nothing fetches a revocation list, nothing expires the trust file, and nothing checks how old it is. Operationally that means revocation propagates exactly as fast as the operator pushes the updated trust file to each consumer, and a consumer that never receives the update keeps trusting the compromised key until the envelope's own expiry runs out. Expiry is mandatory for this reason: it is the only bound that does not depend on distribution.
- Plan for it: keep the trust file in the same configuration-management channel as the rest of the host's MCP configuration, keep signature lifetimes short enough that an unreachable consumer fails closed within your tolerance, and treat "trust file last updated" as an operational metric.

There is **no per-release revocation**. A single bad release cannot be revoked without burning the key that signed it. The partial substitutes are the rollback floor (`minimumVersions` in the trust file, and the recorded last-good version) and re-signing the good release with a shorter expiry after rotating. Adding a per-release deny list to the trust file is open work.

## Installer and marketplace gap

The checked-in Codex and Claude marketplace descriptors contain only source, manifest and presentation metadata. This repository has no installer callback, no activation hook, and no field for injecting operator trust paths, and none is invented here.

The consequence, stated plainly: **the archive verification step before extraction/registration, and the ownership of the host MCP configuration, remain a trusted-installer responsibility that this repository cannot enforce.** Everything above is what the repository can prove once the launcher is actually invoked. Treat the status as accepted-with-residual-risk, not closed, until an installer owns the registration.

The signed envelope covers its algorithm, key ID, signing time, expiry, and manifest. No trust key is embedded in this repository, and the repository does not silently alter Codex/Claude marketplace behavior or publish artifacts.
