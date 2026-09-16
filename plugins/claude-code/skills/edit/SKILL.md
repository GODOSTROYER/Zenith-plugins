---
name: edit
description: Prepare a reviewed service/resource/binding/route/configuration edit, manifest replacement or Compose import.
---

# Zenith edit

Use `zenith_get_edit_fields` to discover the finite registered action fields. Prefer `kind: system.edit` with its curated edit name and parameters for a targeted change. Never inject actor, integration, approved, workspace or project overrides. Canonical backend validation is authoritative.

The curated edits are the service, resource, binding and route edits, plus:

- `env.set` `{serviceId, key, value}` for plain, non-secret configuration.
- `secret.adopt` `{serviceId, key, secretRef}` or `{serviceId, key, moveExistingValue: true}`.
- `secret.remove` `{serviceId, key}`.
- `service.scale` `{serviceId, replicas?, size?}`.

Never ask the user for a secret value, and never put one in `env.set`. Zenith refuses secret-looking keys and values with `secret_value_refused`. Follow the `secrets` skill instead, which uses `zenith_get_handoff` with `task: "secret.set"` so the person enters the value in the browser.

For a full replacement use `manifest.replace`, the explicit target, stable requestKey, intended valid manifest, and the unredacted state's server-provided expectedHash. Do not submit redaction placeholders or guess secret values. `manifest.importCompose` accepts Compose text for the selected existing project; explain unsupported elements and replacement semantics. To start a new project from Compose or a blueprint, see the `workspace` skill.

Return the plan and browser approval URL; execute only after verified approval, then reinspect the working copy. Editing is not deployment.
