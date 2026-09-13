---
name: publish
description: Package explicit supported frontend source and publish through a reviewed Zenith operation.
---

# Zenith publish

Read the actual hosted capability and app-owner grant first. This is restricted React/Vite source publishing, not arbitrary backend/Next.js hosting. Use the packaged `source` CLI with explicit --root and repeated --include paths; first inspect its inventory and SHA-256 without uploading. Never include secrets, dotfiles, node_modules, lockfiles, unsupported build scripts, links or unrelated files.

With user-authorized source transfer, use --upload APP_ID --confirm-upload and the trusted writable connection. Bytes travel outside model context. Preserve uploadId and exact sha256, then prepare `app.publish`, obtain browser approval and execute the durable operation. Inspect the app/release/job result; a successful upload is not publication. Creating an app uses separately reviewed `app.create`; its new app ID must be authorized before later app-scoped actions. Keep a healthy release on candidate failure.
