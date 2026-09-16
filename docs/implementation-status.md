# Implementation checkpoint — 0.2.0-dev.1

[Home](../README.md) · [Control contract](control-v2.md) · [Remaining scope](roadmap.md)

> **0.3.0-dev.1 addendum.** `login`, `logout` and `status` add the browser link flow, twelve shared skills now include `link`, and local write enablement follows the granted scopes. No MCP tool, no contract version and no existing tool shape changed. The rest of this checkpoint still describes 0.2.0-dev.1 and is left as the snapshot it was; [the roadmap](roadmap.md) carries what 0.3.0-dev.1 added and what it still depends on.

The original read-only foundation (plugin PR #2) is now merged to `main`. The v2 implementation was initially submitted as stacked PR #3, which was merged into the former foundation branch rather than `main`. **[PR #4](https://github.com/GODOSTROYER/Zenith-plugins/pull/4) is the integration PR targeting `main`.** It preserves v1 and delivers the opt-in maintained-SDK v2 path.

The authoritative backend is implemented in [Zenith PR #6](https://github.com/GODOSTROYER/zenith/pull/6), merged at `5544ff6f78372879faf757ab20203e9b97d0463e`. Backend code owns durable proposals, trusted browser review, live authorization, actual actions and upload storage. Packages own setup, workflow knowledge, source preflight and transport. Neither plugin opens backend stores or approves its own work.

The implementation covers nine proposal kinds and 24 scoped tools: exact edits/import, deploy/rollback/promotion, app creation/publishing/code rollback, operation handoff, revision comparison, logs and incidents. Eleven shared skills and two read-oriented Claude reviewers are distributed with the same generated runtime.

The integration hardening includes token-free remote OAuth bootstrap, Windows native input/Unicode and short-path handling, explicit security-descriptor checks, Windows CurrentUser DPAPI credentials, macOS Keychain credentials, and bounded non-secret diagnostics. The Keychain path accepts the secret only on stdin; profiles store only a service/account reference. The exact implementation and automated evidence are documented in [verification](verification.md); native client installation and real provider/identity-provider acceptance remain separate.

Backend writes are deliberately limited to one long-lived POSIX process with the supported file store and private persistent journal. Remote OAuth uses a maintained external authorization provider and native-client lifecycle, not an in-house authorization server. Distributed coordination, notification/webhook delivery, aggregate service metrics, GitHub comment automation and Windows named-profile ACL storage remain honestly open in the roadmap. They are not mislabeled as installation tasks.

Builds do not merge PRs, publish packages or expose infrastructure. Release signing is available only through the separately authorized review-artifact workflow and has not been invoked.
