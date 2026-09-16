# Current tool inventory

[Home](../README.md) · [V2 guide](control-v2.md)

The backend advertises only the permitted subset; names alone never authorize use. V2 retains all thirteen original reads/previews/exports:

- `zenith_get_context`
- `zenith_get_capabilities`
- `zenith_list_projects`
- `zenith_get_project`
- `zenith_get_manifest`
- `zenith_list_environments`
- `zenith_plan_deploy`
- `zenith_list_deployments`
- `zenith_get_deployment`
- `zenith_get_events`
- `zenith_get_findings`
- `zenith_get_drift`
- `zenith_export_project`

## Version-2 control tools

| Tool | Required scope | Side effects | Purpose |
|---|---|---|---|
| `zenith_prepare_change` | plan | Persists proposal | Persist an exact proposal for browser review. Never executes or approves. Manifest edits require the current manifest hash. Source publishing requires a separate verified binary upload. |
| `zenith_execute_operation` | write | Dispatches reviewed operation | Dispatch a previously browser-approved proposal at most once. An uncertain outcome must be investigated, never automatically retried with a new key. |
| `zenith_get_operation` | read | Read | Read a durable operation and associated deployment/job evidence. Dispatch success is not deployment success. |
| `zenith_list_operations` | read | Read | List authorized same-user operations across clients, with bounded pagination. |
| `zenith_get_operation_events` | read | Read | Read bounded operation journal events for an authorized operation. |
| `zenith_list_revisions` | read | Read | List exact revision IDs for an authorized project; no source secrets. |
| `zenith_compare_revisions` | read | Read | Compare two immutable same-project revisions with estimated cost and topology changes. |
| `zenith_get_logs` | logs | Read | Read a bounded page of conservatively redacted deployment log events. Requires separate logs scope. User-authored text remains untrusted and may be sensitive. |
| `zenith_incident_bundle` | read | Read | Collect bounded recorded status, findings and events for one deployment. Does not probe providers, start jobs or include free-form logs. |
| `zenith_get_edit_fields` | read | Read | Read the exact curated edit field names and examples from the registered action inputs. No arbitrary action execution is exposed. |
| `zenith_get_app` | read | Read | Read app status and retained releases for an explicitly app-scoped owner. |

## Workspace coverage tools

Added within contract version 2. All are reads (`mutates: false`). A backend without them simply does not list them, and the connector never calls a tool the backend did not list.

| Tool | Required scope | Target | Purpose |
|---|---|---|---|
| `zenith_list_workspaces` | read | none | The credential subject's own memberships: `id`, `name`, `role`, `current`, and a `relink` command for the others. Names and roles only. |
| `zenith_get_workspace` | read | none | The bound workspace: name, slug, role, autonomy, `scopeMode`, project and member counts, connections without credentials. |
| `zenith_list_blueprints` | read | none | The blueprint catalogue for `project.createFromBlueprint` / `project.applyBlueprint`. |
| `zenith_list_secrets` | read | optional project | Secret references, versions, `updatedAt`, `updatedBy` and using service keys. Never a value. |
| `zenith_get_alerts` | read | project | Rules, up to 50 events, and channels as `{id, kind, name, enabled, targetOrigin}`; never a channel URL or secret. |
| `zenith_get_audit` | read | project | Bounded (`limit` ≤ 100, `offset`), redacted audit rows. |
| `zenith_investigate` | read | environment | Zenith's read-only investigation (`ops.investigate`). |
| `zenith_get_health` | read | environment | The health projection. |
| `zenith_get_service_logs` | logs | environment + `serviceId` | Redacted service log events (`after`, `limit` ≤ 100) with an untrusted-text warning. |
| `zenith_discover_resources` | read | `{workspaceId}` + `connectionId` | Importable resources on a sandbox or LocalStack connection. |
| `zenith_list_apps` | read | none | Hosted apps the subject holds an owner grant for: `id`, `slug`, `state`, `role`. |
| `zenith_get_handoff` | read | optional | A tryzenith.cloud URL, instructions and, where relevant, a command for a task a person must do in the browser. It never carries a value or a user-supplied URL. |

`zenith_get_handoff` tasks: `workspace.create`, `workspace.autonomy`, `account`, `account.export`, `account.delete`, `members`, `invites`, `secret.set`, `secret.rotate`, `connection.credentials`, `alerts.channel`, `environment.policies`, `environment.delete`, `project.delete`, `deploy.approve`, `operation.review`, `app.audience`, `relink`. Optional inputs: `target`, `deploymentId`, `operationId`, `appId`, `name`.

## Proposal kinds

`zenith_prepare_change` takes `kind`, `target` and `requestKey`. `target.workspaceId` is always required; `projectId` and `environmentId` depend on the kind. `zenith_get_capabilities` reports `preparationKinds` and `scopeMode` so a skill can check before proposing.

| Level | Target | Kinds |
|---|---|---|
| Workspace (needs a Whole-workspace link, else `workspace_scope_required`) | `{workspaceId}` | `project.create`, `project.createFromCompose`, `project.createFromBlueprint`, `workspace.rename`, `connection.create` (`sandbox` or `localstack` only), `connection.check`, `connection.disconnect`, `alerts.updateChannel`, `alerts.testChannel`, `alerts.deleteChannel` |
| Project | `{workspaceId, projectId}` | `manifest.replace`, `manifest.importCompose`, `system.edit`, `project.applyBlueprint`, `project.importResources`, `environment.create`, `alerts.createRule`, `alerts.updateRule`, `alerts.deleteRule`, `alerts.acknowledge`, `finding.dismiss`, `finding.reopen`, `finding.resolve`, `app.create`, `app.publish`, `app.rollback`, `app.suspend`, `app.resume` |
| Environment | `{workspaceId, projectId, environmentId}` | `deployment.deploy`, `deployment.rollback`, `deployment.promote`, `deployment.cancel`, `ops.restart`, `environment.clone`, `environment.update`, `environment.setBudget`, `environment.setConnection`, `environment.tightenPolicies` |

`system.edit` names one curated edit: `service.add`, `service.update`, `service.remove`, `resource.add`, `resource.update`, `resource.remove`, `binding.set`, `binding.remove`, `route.add`, `route.update`, `route.remove`, `env.set`, `secret.adopt`, `secret.remove`, `service.scale`. `env.set` refuses secret-looking keys and values with `secret_value_refused`; `secret.adopt` takes a `secretRef` or `moveExistingValue: true`, never a value. `environment.tightenPolicies` can only set `approvalRequired: true` or `allowStatefulDeletion: false`.

Not proposals, by design: approving a deployment, deleting a project or environment, loosening policies, workspace autonomy, creating an alert channel, setting or rotating a secret value, member and invite changes, and Navigator runs.

Preparation also checks the operation-specific write or publish scope. Execution accepts write or publish only as permitted for the saved operation. Source bytes use the separate bounded authenticated upload endpoint, not an MCP base64 tool. A plan preview from v1 is not an executable v2 receipt.

The canonical versioned schema snapshot is `contracts/control-v2.json`. `npm run contracts:check -- --backend ABSOLUTE_PATH` detects backend drift without making the installed package import sibling-repository code. `node scripts/contracts.mjs --write --backend ABSOLUTE_PATH` regenerates the snapshot from a backend checkout after checking its tool names against `CONTROL_TOOLS`; review the diff before committing it.
