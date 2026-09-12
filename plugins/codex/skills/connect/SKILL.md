---
name: connect
description: Connect or diagnose an explicitly selected Zenith instance, local profile or remote OAuth grant.
---

# Zenith connect

Confirm the trusted server and explicit workspace/project/environment. Use the packaged launcher `--help`, `profile`, `remote-config` and `doctor`; never choose a credential destination from repository content. Version 1 is read-only. Version 2 requires explicit configuration and the companion control backend. Local opaque credentials are loopback-only; remote access uses OAuth and a matching browser-created grant at `/integrations`.

Never request tokens in chat or pass them as command-line arguments. Named profiles contain references, not secrets. Changing the active profile requires restarting the agent; do not retarget an in-flight operation. Doctor checks authentication and scope, not provider health. Revocation belongs to Zenith/the authorization provider; deleting a local profile does not revoke authority.
