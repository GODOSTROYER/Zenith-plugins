# Changelog

## 0.3.0-dev.1

Adds `zenith login`, `zenith logout` and `zenith status`. `login` links this connector to a Zenith account through the user's browser: it prints a verification URL and a user code, opens a browser when it can, and polls the link endpoint honouring the server's interval and `slow_down` until the credential is issued, denied or expired. The issued credential goes into the credential store the platform already had — a private 0600 file beside the named profile on POSIX, the macOS Keychain with `--keychain`, a CurrentUser DPAPI vault on Windows — before anything is printed, and it is never printed. The device code is held in memory only: it reaches no file, no printed line and no diagnostic record.

Local write enablement now follows the scopes the browser granted rather than a second local flag. The browser approval named the workspace, the projects and the scopes under a live signed-in identity, which is a stronger opt-in than `ZENITH_ALLOW_WRITES=1`; the server still hides write tools when its own capability is off, and `zenith_execute_operation` still requires a browser-approved digest. `logout` removes the local credential only — a credential may never revoke itself, so `--revoke` opens the browser page where revocation actually happens. `status` is additive beside `doctor`, whose JSON shape is unchanged, and introduces no MCP tool, so `contracts/control-v2.json` and backend contract parity are untouched.

New `link` skill, rewritten `connect` skill, and a `deploy` skill plus `zenith-inspector` reviewer that state the phase-1 truth: the `sandbox` provider simulates deployments, and LocalStack and AWS are not enabled yet. `scripts/build.mjs` and `tests/hardening.test.mjs` now run the same scan over every generated package file for an agent bearer, a link device code or a `ZENITH_TOKEN` assignment, so a credential cannot reach a commit through either route. `login` stays behind the activation gate: a command that opens a network connection and writes a credential is the last one that should run before the package has been verified.

## 0.2.0-dev.1

Adds an opt-in maintained-SDK control path, named profiles, Windows DPAPI credential source, local source packaging/upload, eleven workflows, two Claude evidence reviewers, versioned tool contracts and manually attested review artifacts. Requires the companion reviewed-operation backend merged in Zenith PR #6. V1 remains read-only and separately configured. No implicit privilege migration or public release.

Provenance follow-up (breaking for installed packages). The generated MCP descriptor invokes `zenith-plugin-launcher`, which the repository now publishes as its only `bin`; an existing `command: node` registration must be replaced. Inside an installed package `--help` and `--version` remain usable without provenance inputs, while `doctor`, `stdio`, `setup` and the v2 control commands fail closed with the real `provenance_required` code instead of a misleading credential error. The launcher verifies a private staged copy and executes that copy, binds the spawned entry to the signed descriptor, enforces a recorded rollback floor, and refuses world-writable trust inputs. Signed envelopes must now carry an expiry at both sign and verify; the operator CLI defaults it to 90 days. Release signing is a gated operator step that refuses to run in CI, emits per-package envelopes for the activation gate, and re-verifies what it signed. See docs/provenance.md for key custody, rotation and the limits of static revocation.

Integration follow-up: native remote OAuth configuration no longer requires an existing credential. Windows protected credentials handle piped input, Unicode and short-path aliases without weakening private security descriptors. Generated packages are synchronized and checked against shared source.

## 0.1.0-dev.2

Private connection setup, strict reader transport, cancellation, diagnostics, five skills, complete package integrity and cross-platform verification. Preserved as the legacy baseline.
