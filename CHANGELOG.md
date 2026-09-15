# Changelog

## 0.2.0-dev.1

Adds an opt-in maintained-SDK control path, named profiles, Windows DPAPI credential source, local source packaging/upload, eleven workflows, two Claude evidence reviewers, versioned tool contracts and manually attested review artifacts. Requires the companion reviewed-operation backend merged in Zenith PR #6. V1 remains read-only and separately configured. No implicit privilege migration or public release.

Provenance follow-up (breaking for installed packages). The generated MCP descriptor invokes `zenith-plugin-launcher`, which the repository now publishes as its only `bin`; an existing `command: node` registration must be replaced. Inside an installed package `--help` and `--version` remain usable without provenance inputs, while `doctor`, `stdio`, `setup` and the v2 control commands fail closed with the real `provenance_required` code instead of a misleading credential error. The launcher verifies a private staged copy and executes that copy, binds the spawned entry to the signed descriptor, enforces a recorded rollback floor, and refuses world-writable trust inputs. Signed envelopes must now carry an expiry at both sign and verify; the operator CLI defaults it to 90 days. Release signing is a gated operator step that refuses to run in CI, emits per-package envelopes for the activation gate, and re-verifies what it signed. See docs/provenance.md for key custody, rotation and the limits of static revocation.

Integration follow-up: native remote OAuth configuration no longer requires an existing credential. Windows protected credentials handle piped input, Unicode and short-path aliases without weakening private security descriptors. Generated packages are synchronized and checked against shared source.

## 0.1.0-dev.2

Private connection setup, strict reader transport, cancellation, diagnostics, five skills, complete package integrity and cross-platform verification. Preserved as the legacy baseline.
