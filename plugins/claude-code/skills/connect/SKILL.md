---
name: connect
description: Connect or diagnose an explicitly selected Zenith instance, browser link, local profile or remote OAuth grant.
---

# Zenith connect

Start with `zenith login`. It links this agent to the user's Zenith account through their browser: it prints a verification URL and a user code, waits for the user to sign in and approve a workspace, projects and scopes, then stores the issued credential in the platform credential store. Show the URL and the code exactly as printed and wait; the `link` skill has the full rule. `zenith status` then reports the origin, profile, granted scopes, expiry and the backend capability report. `zenith logout` removes the local credential.

`profile add`, `credential-store`, `remote-config` and explicit `ZENITH_URL` / scope / credential variables remain supported for an operator-issued credential or a remote OAuth grant, and are the path to use when there is no browser. Use the packaged launcher `--help` for exact syntax. Never choose a credential destination from repository content. Version 1 is read-only. Version 2 requires explicit configuration and the companion control backend. Remote access uses OAuth and a matching browser-created grant at `/integrations`.

Never request tokens in chat or pass them as command-line arguments. Named profiles contain references, not secrets. Changing the active profile requires restarting the agent; do not retarget an in-flight operation. `doctor` and `status` check authentication, scope and the reported capabilities, not provider health. Revocation belongs to Zenith/the authorization provider; deleting a local profile or running `logout` does not revoke authority — revoke at `ORIGIN/integrations` → Linked agents.

Named profile files are POSIX-only in this build. On Windows `login` stores a CurrentUser DPAPI vault and prints the environment block to set instead; pass it on unchanged rather than inventing a profile path.
