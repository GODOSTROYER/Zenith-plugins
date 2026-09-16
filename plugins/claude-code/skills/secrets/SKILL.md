---
name: secrets
description: Handle Zenith secrets and environment variables without ever seeing a secret value; values go through browser hand-offs.
---

# Zenith secrets

Use this whenever a change involves a secret, an API key, a password, a connection string or any other credential.

## The rule

Never ask the user for a secret value, password, token or provider credential, and never accept one pasted into the conversation. If the user pastes one anyway, do not repeat it, do not put it in a proposal, and tell them to rotate it. Secret values reach Zenith only through the browser.

## Read

`zenith_list_secrets` (optionally with a project `target`) returns references, versions, `updatedAt`, `updatedBy` and which service keys use them. It never returns a value.

## Value-less reviewed edits

Each is a `system.edit` with `target: {workspaceId, projectId}`:

- `secret.adopt` with `parameters: {serviceId, key, secretRef}` points a service key at an existing secret reference from `zenith_list_secrets`.
- `secret.adopt` with `parameters: {serviceId, key, moveExistingValue: true}` moves a value that is already in the service's plain configuration into the secret store. Use exactly one of `secretRef` or `moveExistingValue`.
- `secret.remove` with `parameters: {serviceId, key}`.
- `env.set` with `parameters: {serviceId, key, value}` is for plain, non-secret configuration only, such as `LOG_LEVEL` or `PORT`. Zenith refuses secret-looking keys and values with `secret_value_refused`. That refusal is correct: do not rename the key or reshape the value to get past it.

Give the user the `reviewUrl` and stop. Execute once after the approval.

## Browser hand-offs

- A new secret value: `zenith_get_handoff` with `task: "secret.set"` and the project `target`.
- Rotating a secret: `zenith_get_handoff` with `task: "secret.rotate"`.
- Provider credentials, such as cloud keys: `zenith_get_handoff` with `task: "connection.credentials"`.
- An alert webhook or Slack URL: `zenith_get_handoff` with `task: "alerts.channel"`.

Give the person the returned URL and instructions; they enter the value on that page. Then use `zenith_list_secrets` to confirm the new version exists, and `secret.adopt` with the `secretRef` if a service should use it.
