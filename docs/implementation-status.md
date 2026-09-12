# Implementation checkpoint — dev.2

[Home](../README.md) · [Verification](verification.md) · [Release gates](roadmap.md)

Baseline inspected: `Zenith-plugins/main` at `13d1497b91aa990d1707ee3a1c164b49a327acfb`; Zenith `master` at `2d56ecc3abe77f560d9c58bee14370b0789f386a`. The latter merged the read-only companion previously described as unmerged. No backend code is changed by this increment.

The user-provided `Zenith-plugins-build-prompt.md` is the product target, not a claim that this increment completes its definition of done. Analysis found an existing dev.1 reader, 29 fixture tests, two skills and generated packages. It also found initialization races, permissive response validation, configuration reads bounded only after allocation and incomplete generated-file checks. This increment extends that implementation rather than replacing the architecture.

| Prompt area | Status in this increment |
| --- | --- |
| Two-repository separation / standalone MCP / two native package layouts | Retained and strengthened; no backend internals in distribution |
| Setup and actionable diagnostics | Implemented private POSIX profiles, explicit env fallback, scope/contract verification and opt-in redacted diagnostics |
| Transport reliability | Implemented initialization state machine, cancellation/shutdown, immutable request/destination scope, deadlines and contract checks |
| Shared workflows | Five generated skills: connect, inspect, plan, observe, export |
| Reproducible bundles / local release preparation | Implemented full file inventories, hidden-file archive checks and deterministic local review artifacts; no publishing |
| Real local Zenith / actual Codex and Claude behavior | Test command supplied, not executed against real Zenith/native binaries here |
| Maintained MCP SDK / remote OAuth | Not implemented; limited stateless JSON profile remains explicit |
| Editing, deploy, rollback, approval, persistent receipts/operations | Blocked on authoritative backend implementation and tests; no client bypass |
| Hosted source publishing | Not implemented; requires backend grants/jobs and safe source transfer |
| Native skill evaluation / provider/store parity / distributed guarantees | Not verified; fixtures are not substitutes |

No subagent facility was available; both client tracks were implemented sequentially from shared sources. No independent-agent review is claimed. Registry access and native binaries were unavailable in the local environment. Clean installs succeeded in GitHub CI, which also exposed macOS symlinked-entrypoint and Windows stat-identity differences. Symlinked launch was fixed; Windows file configuration refuses unavailable identity rather than bypassing it. Environment-based connections remain supported.

Next: run the reader against isolated real Zenith data and actual client binaries; capture negotiated versions and authorization evidence. Then migrate the shared protocol through a maintained SDK without weakening bounds or contracts. Add backend durable preparation/approval/execution and restart-safe operations before any write tool. Remote OAuth and source publishing have independent release gates.
