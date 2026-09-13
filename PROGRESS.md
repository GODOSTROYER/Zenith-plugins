# Control v2 checkpoint

Version `0.2.0-dev.1`: shared SDK runtime, named profiles, Windows DPAPI credential adapter, explicit binary source preflight/upload, reviewed operations, eleven shared skills, two read-oriented Claude evidence reviewers, contract parity and manual attested artifacts.

Backend companion [PR #6](https://github.com/GODOSTROYER/zenith/pull/6) is merged: authenticated grants, browser approval, persisted proposals/operations, curated edits/import/deploy/rollback/promotion, hosted-source publishing and scoped diagnostics. The backend owns all permissions and side effects.

[Plugin PR #4](https://github.com/GODOSTROYER/Zenith-plugins/pull/4) targets main and includes the feature implementation plus token-free remote OAuth setup and tested Windows credential fixes. The earlier stacked PR #3 was merged into the old foundation branch rather than main; no feature work was discarded. Generated packages have been synchronized and the temporary assembly workflow removed.

See [verification](docs/verification.md) for actual evidence and [remaining scope](docs/roadmap.md) for features that are intentionally still incomplete. Live/native installation remains separate. Do not merge, publish or expose a server automatically.
