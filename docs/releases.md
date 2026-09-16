# Compatibility, artifacts and releases

[Home](../README.md) · [Verification](verification.md)

Publisher-authenticated release signing and the operator trust workflow are documented in [Publisher provenance](provenance.md). Hash inventories alone do not authenticate a publisher.

## Compatibility

Version 1 is retained as an explicit legacy read-only path. Version 2 requires the version-2 Zenith control contract and explicit client/server write enablement. Incompatible contracts fail closed; a server advertising a new tool cannot add authority to an installed plugin automatically. Adding a client surface reuses the shared transport and backend; it is not a new deployment implementation.

Record the exact backend/plugin/client/Node versions with each accepted release. Deprecations require a documented replacement and one supported migration release; removal requires a major contract version. Pre-release versions remain development builds, not a production-support commitment.

## Prepare and review

Use the committed lockfile and run verification before generating local review archives with `npm run release:prepare`. Both packages include dependency notices and their exact generated runtime. File inventories and SHA256SUMS detect changes; without an attestation they do not identify a publisher. Always replace the entire package on upgrade and restart the client.

## Release checklist

1. `npm ci --ignore-scripts`, then `npm run verify`. The verify lane runs `provenance:selftest`, which exercises sign-package, verify-package and a launcher activation against a throwaway key in a temporary directory.
2. `npm run version:prepare -- VERSION`, regenerate the lockfile, rebuild, update this CHANGELOG, review the complete diff.
3. **Sign, as the release operator, on a machine that is not a build agent** — see [key custody](provenance.md):

   ```bash
   npm run release:sign -- \
     --key-id publisher-2026 \
     --private-key "$HOME/.config/zenith-publisher/publisher-2026.private.pem" \
     --trust "$HOME/.config/zenith-publisher/trusted-keys.json"
   ```

   This runs the verify lane, rebuilds both packages in the [signed-release shape](provenance.md#unsigned-preview) (`npm run build:signed`, which writes the `zenith-plugin-launcher` descriptor the launcher binds its invocation to), then writes `artifacts/release-manifest.json` plus one `zenith-CLIENT-VERSION.package-manifest.json` per client and re-verifies both. It refuses to run in CI, and it refuses a key path inside the checkout. `npm run release:prepare` is the unsigned equivalent and labels its output as unsigned.

   Run `npm run build` afterwards to leave the checkout in its committed unsigned-preview shape; CI diffs `plugins/**` against a default build.
4. Distribute the release envelope with the archives, and the **package** envelope with each installed package — the runtime activation gate needs the package envelope, not the release manifest.
5. Consumers run `npm run provenance:verify -- --artifacts DIR --manifest DIR/release-manifest.json --trust TRUST_FILE` before extracting or registering anything.
6. Record the key id, the signature expiry and the trust-file revision alongside the backend/plugin/client/Node versions. Signature expiry is mandatory and defaults to 90 days; plan the next signing before it lapses.

Key custody, rotation with an overlap window, and the operational limits of the static `status: "revoked"` field — which has no freshness requirement and propagates only as fast as the operator pushes an updated trust file — are documented in [Publisher provenance](provenance.md). There is no per-release revocation; a bad release is handled with a rollback floor and a rotation, not a revoked release.

`npm run version:prepare -- VERSION` updates source version markers and root package metadata without creating a tag, commit or release. Then regenerate the lockfile with the reviewed dependency set, build, verify, update CHANGELOG and review the complete diff before committing.

## Optional signed artifacts

The `Attest reviewed plugin artifacts` workflow is **manual-only** and restricted to `main`. It requires the exact checked-out commit and explicit `CREATE_REVIEW_ARTIFACTS` confirmation. It builds/verifies with the lockfile, creates both archives, generates an npm CycloneDX dependency SBOM and requests GitHub/Sigstore provenance and SBOM attestations. No GitHub release, npm publish, container push or marketplace submission occurs.

The SBOM describes declared runtime dependencies from the lockfile, which can be a superset of tree-shaken bundled code. `runtime/control/components.json` separately records packages contributing to the bundle. Signing binds artifact digests to this workflow/commit; it does not certify safe application behavior or grant a license. Your GitHub plan/repository must support attestations; unsupported configurations fail rather than producing unsigned success.

After downloading the generated artifacts and attestations, use GitHub CLI's attestation verification against `GODOSTROYER/Zenith-plugins` and verify the expected commit/workflow. Only then consider separate owner-authorized publication. Do not run this workflow automatically from untrusted pull requests.
