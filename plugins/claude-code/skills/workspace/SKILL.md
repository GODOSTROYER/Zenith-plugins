---
name: workspace
description: List, create, switch and administer Zenith workspaces and create projects in one, with browser hand-offs for people and settings.
---

# Zenith workspace

Use this when the user asks which workspaces they have, wants a new workspace or project, wants to work in a different workspace, or asks about members, invites, autonomy or account settings.

## Read first

- `zenith_list_workspaces` returns the signed-in person's own memberships: `id`, `name`, `role`, `current`, and for every other workspace a `relink` command. It lists names and roles only.
- `zenith_get_workspace` returns the current workspace: name, slug, role, `scopeMode`, project and member counts, and connections without credentials.
- `zenith_get_capabilities` reports `scopeMode` (`projects` or `workspace`) and `preparationKinds`. Check both before proposing a workspace-level change.

A credential is bound to one workspace. Never try to reach another workspace with the current one.

## Switch workspace

1. If a profile for that workspace already exists, run the connector's `profile use NAME` (`profile list` shows the names). The running Zenith server follows it on its next tool call and announces a changed tool list.
2. Otherwise run the `relink` command from `zenith_list_workspaces`, which is `login --workspace ID`, and follow the `link` skill. The page preselects that workspace only if the person is a member; the person can still choose another.
3. Call `zenith_get_context` afterwards and report the workspace it names. Do not assume the switch worked.

Hosts that ignore tool-list changes need the Zenith server reconnected once after a switch. Say so if the tool list did not change.

## Create a workspace (browser hand-off)

The agent never creates a workspace. It hands the task to the person in the same conversation:

1. Call `zenith_get_handoff` with `task: "workspace.create"` and the name the user gave, if any. It returns the exact command and a fallback URL.
2. Run the returned `login --new-workspace "NAME"` command and show the URL and code exactly as printed. On the page the person checks the name, clicks **Create**, keeps **Whole workspace** selected and approves.
3. `login` saves a new profile named after the workspace and makes it active. Continue once `zenith_get_context` names the new workspace.

The name is only a hint that fills a text box. Nothing is created until the person clicks Create.

## Create a project (reviewed)

Project creation needs a whole-workspace link. If `scopeMode` is `projects`, or preparation fails with `workspace_scope_required`, say so and offer `zenith_get_handoff` with `task: "relink"`, or run `login` and ask the person to choose **Whole workspace**.

- `zenith_prepare_change` with `kind: "project.create"`, `target: {workspaceId}` only, `name`, optional `slug`, `withEnvironment` (default true) and optional `connectionId`.
- `kind: "project.createFromCompose"` takes `name` and `composeYaml`. `kind: "project.createFromBlueprint"` takes a `blueprint` ID from `zenith_list_blueprints`.
- To apply a blueprint to an existing project, use `kind: "project.applyBlueprint"` with `target: {workspaceId, projectId}`.
- `kind: "workspace.rename"` takes `name` and needs an administrator's approval.

Every proposal returns a `reviewUrl`. Give it to the user and stop. After the browser approval, call `zenith_execute_operation` once, then `zenith_get_operation`. Its evidence names the new `projectId`, `slug` and `environmentId`. Target that project by ID from then on. Reuse the same `requestKey` for a retry of the same intent, so a retry cannot create two projects.

## Connections

`zenith_discover_resources` lists what a `sandbox` or `localstack` connection can import. `connection.create` accepts only `provider: "sandbox"` or `"localstack"`, with optional `label` and `region`. `connection.check` and `connection.disconnect` take a `connectionId`. All three are workspace-level proposals. `project.importResources` imports up to 50 `resources[].externalRef` into an existing project.

Provider credentials, such as AWS keys, never go into this conversation. Use `zenith_get_handoff` with `task: "connection.credentials"`; the person enters them in the browser.

## Human-only settings

Use `zenith_get_handoff` and give the person the returned URL for:

- `members` (role changes, removal) and `invites`;
- `workspace.autonomy`;
- `account`, `account.export` and `account.delete`;
- `project.delete`.

Do not collect invitee email addresses or member details in chat, and do not describe these tasks as done until the person confirms.
