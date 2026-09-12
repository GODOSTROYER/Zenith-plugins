# Implementation checkpoint — 0.2.0-dev.1

[Home](../README.md) · [Control contract](control-v2.md) · [Remaining scope](roadmap.md)

The original read-only foundation (plugin PR #2) is now merged to `main`. The v2 implementation was initially submitted as stacked PR #3, which was merged into the former foundation branch rather than `main`. **[PR #4](https://github.com/GODOSTROYER/Zenith-plugins/pull/4) is the integration PR targeting `main`.** It preserves v1 and delivers the opt-in maintained-SDK v2 path.

The authoritative backend is implemented in [Zenith PR #6](https://github.com/GODOSTROYER/zenith/pull/6), merged at `5544ff6f78372879faf757ab20203e9b97d0463e`. Backend code owns durable proposals, trusted browser review, live authorization, actual actions and upload storage. Packages own setup, workflow knowledge, source preflight and transport. Neither plugin opens backend stores or approves its own work.

The implementation covers nine proposal kinds and 24 scoped tools: exact edits/import, deploy/rollback/promotion, app creation/publishing/code rollback, operation handoff, revision comparison, logs and incidents. Eleven shared skills and two read-oriented Claude reviewers are distributed with the same generated runtime.

The follow-up integration fixes token-free remote OAuth bootstrap, Windows native input/Unicode and short-path handling, explicit security-descriptor checks and bounded non-secret diagnostics. The exact implementation and automated evidence are documented in [verification](verification.md); native client installation and real provider/identity-provider acceptance remain separate.

Backend writes are deliberately limited to one long-lived POSIX process with the supported file store and private persistent journal. Remote OAuth uses a maintained external authorization provider and native-client lifecycle, not an in-house authorization server. Distributed coordination, notification/webhook delivery, aggregate service metrics, GitHub comment automation and additional native credential integrations remain honestly open in the roadmap. They are not mislabeled as installation tasks.

Builds do not merge PRs, publish packages or expose infrastructure. The temporary feature-branch-only bundle synchronization workflow has been removed. Release signing is available only through the separately authorized review-artifact workflow and has not been invoked.
