---
name: edit
description: Prepare a reviewed service/resource/binding/route edit, manifest replacement or Compose import.
---

# Zenith edit

Use `zenith_get_edit_fields` to discover the finite registered action fields. Prefer `kind: system.edit` with its curated edit name and parameters for a targeted change. Never inject actor, integration, approved, workspace or project overrides. Canonical backend validation is authoritative.

For a full replacement use `manifest.replace`, the explicit target, stable requestKey, intended valid manifest, and the unredacted state's server-provided expectedHash. Do not submit redaction placeholders or guess secret values. `manifest.importCompose` accepts Compose text for the selected existing project; explain unsupported elements and replacement semantics. Return the plan and browser approval URL; execute only after verified approval, then reinspect the working copy. Editing is not deployment.
