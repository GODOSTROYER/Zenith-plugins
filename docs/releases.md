# Compatibility, artifacts and releases

[Home](../README.md) · [Verification](verification.md)

Publisher-authenticated release signing and the operator trust workflow are documented in [Publisher provenance](provenance.md). Hash inventories alone do not authenticate a publisher.

## Compatibility

Version 1 is retained as an explicit legacy read-only path. Version 2 requires the version-2 Zenith control contract and explicit client/server write enablement. Incompatible contracts fail closed; a server advertising a new tool cannot add authority to an installed plugin automatically. Adding a client surface reuses the shared transport and backend; it is not a new deployment implementation.

Record the exact backend/plugin/client/Node versions with each accepted release. Deprecations require a documented replacement and one supported migration release; removal requires a major contract version. Pre-release versions remain development builds, not a production-support commitment.

## Prepare and review

Use the committed lockfile and run verification before generating local review archives with `npm run release:prepare`. Both packages include dependency notices and their exact generated runtime. File inventories and SHA256SUMS detect changes; without an attestation they do not identify a publisher. Always replace the entire package on upgrade and restart the client.

`npm run version:prepare -- VERSION` updates source version markers and root package metadata without creating a tag, commit or release. Then regenerate the lockfile with the reviewed dependency set, build, verify, update CHANGELOG and review the complete diff before committing.

## Optional signed artifacts

The `Attest reviewed plugin artifacts` workflow is **manual-only** and restricted to `main`. It requires the exact checked-out commit and explicit `CREATE_REVIEW_ARTIFACTS` confirmation. It builds/verifies with the lockfile, creates both archives, generates an npm CycloneDX dependency SBOM and requests GitHub/Sigstore provenance and SBOM attestations. No GitHub release, npm publish, container push or marketplace submission occurs.

The SBOM describes declared runtime dependencies from the lockfile, which can be a superset of tree-shaken bundled code. `runtime/control/components.json` separately records packages contributing to the bundle. Signing binds artifact digests to this workflow/commit; it does not certify safe application behavior or grant a license. Your GitHub plan/repository must support attestations; unsupported configurations fail rather than producing unsigned success.

After downloading the generated artifacts and attestations, use GitHub CLI's attestation verification against `GODOSTROYER/Zenith-plugins` and verify the expected commit/workflow. Only then consider separate owner-authorized publication. Do not run this workflow automatically from untrusted pull requests.
