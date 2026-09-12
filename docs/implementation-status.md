# Implementation checkpoint — 0.2.0-dev.1

[Home](../README.md) · [Control contract](control-v2.md) · [Remaining scope](roadmap.md)

This increment builds on unmerged plugin PR #2, preserving the legacy reader while adding a separately enabled maintained-SDK control path. The backend owns durable proposals, trusted browser approval, live authorization and actual actions. Packages own client setup, workflow knowledge, source preflight and transport.

The implemented control path covers nine proposal kinds and 24 total scoped tools. All mutation operations require persisted real-browser approval and exact-state checks. No client action can self-approve, extend a backend scope, or make unsupported providers deploy.

The backend writes are deliberately constrained to its supported single-writer POSIX file-store topology. Remote OAuth uses a maintained external authorization provider and native client lifecycle; it does not add an in-house authorization server. Optional distributed coordination, notification webhooks and GitHub comment automation remain open in the roadmap.

Both repository PRs are required for v2 operation. Plugin PR #2 is a separate prerequisite until merged. No workflow or agent merges the PRs, publishes packages, exposes a service or deploys infrastructure. The early backend checkpoint PR contained CI setup only; use the actual implementation PR linked in the delivery message, not the checkpoint alone.
