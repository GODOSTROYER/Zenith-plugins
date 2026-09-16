---
name: publish
description: Package explicit supported frontend source and publish, suspend or resume a hosted app through reviewed Zenith operations.
---

# Zenith publish

Read the actual hosted capability and app-owner grant first: `zenith_list_apps` lists the apps the person owns, and `zenith_get_app` returns one app's status, releases, health and usage. This is restricted React/Vite source publishing, not arbitrary backend/Next.js hosting. Use the packaged `source` CLI with explicit --root and repeated --include paths; first inspect its inventory and SHA-256 without uploading. Never include secrets, dotfiles, node_modules, lockfiles, unsupported build scripts, links or unrelated files.

With user-authorized source transfer, use --upload APP_ID --confirm-upload and the trusted writable connection. Bytes travel outside model context. Preserve uploadId and exact sha256, then prepare `app.publish`, obtain browser approval and execute the durable operation. Inspect the app/release/job result; a successful upload is not publication. Keep a healthy release on candidate failure.

## App scope

Creating an app uses separately reviewed `app.create`. Publishing, rollback, suspend and resume need the `publish` scope and the person's owner grant on that app. Under a whole-workspace link, an app the agent created is reachable at once. Under a project-list link it may not be; if `app.publish` is refused for scope, say so and offer `zenith_get_handoff` with `task: "relink"`.

## Suspend and resume

- `app.suspend` `{appId, reason?}` takes a live app offline. `app.resume` `{appId, reason?}` brings it back. Both use `target: {workspaceId, projectId}` and need an administrator's approval in the browser.
- Explain the effect on the app's users before proposing a suspend.

## Browser hand-offs

Who can open a hosted app (grants and invites) is managed by people: call `zenith_get_handoff` with `task: "app.audience"` and the `appId`. Launching an app or ending its user sessions is not an agent action.
