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

Preparation also checks the operation-specific write or publish scope. Execution accepts write or publish only as permitted for the saved operation. Source bytes use the separate bounded authenticated upload endpoint, not an MCP base64 tool. A plan preview from v1 is not an executable v2 receipt.

The canonical versioned schema snapshot is `contracts/control-v2.json`. `npm run contracts:check -- --backend ABSOLUTE_PATH` detects backend drift without making the installed package import sibling-repository code.
