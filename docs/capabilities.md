# Tool and capability reference

[Home](../README.md) · [Architecture](architecture.md) · [Remaining work](roadmap.md)

The bridge exposes a fixed allowlist. Zenith supplies tool schemas and decides permissions. The companion adapter below is implemented source but still awaits validation in the complete application. The fixture tests do not prove its integration behavior.

| Tool | Scope | Result / important limit |
| --- | --- | --- |
| `zenith_get_context` | `read` | Explicit selection, member role and credential expiry |
| `zenith_get_capabilities` | `read` | Current profile, provider descriptions and unavailable operations |
| `zenith_list_projects` | `read` | Only authorized projects, bounded page |
| `zenith_get_project` | `read` | Project metadata and working-copy monthly estimate |
| `zenith_get_manifest` | `read` | Redacted working/deployed definition; not all original environment values |
| `zenith_list_environments` | `read` | Authorized project environments |
| `zenith_plan_deploy` | `plan` | Action-registry preview with `executable: false` and `receipt: null` |
| `zenith_list_deployments` | `read` | Environment deployment metadata |
| `zenith_get_deployment` | `read` | Status, steps and conservatively redacted outputs |
| `zenith_get_events` | `read` | Sequence-based events; free-form log events excluded |
| `zenith_get_findings` | `read` | Stored findings; no rule evaluation or notification delivery |
| `zenith_get_drift` | `read` | Read-back against a deployed revision, or an explicit provider refusal |
| `zenith_export_project` | `export` | Generated bundle based on a redacted manifest; no local file write or apply |

Every credential must include `read`; `plan` and `export` are optional. Listing tools does not authorize a call independently of the checks at execution time. Scope in request headers can narrow a credential but cannot enlarge it. Explicit tool arguments cannot escape the selected project/environment.

## Result contract

Successful calls return a text representation for client compatibility and a `structuredContent` object containing `data`, `contractVersion: 1`, and `mode: "read-only"`. Tool failures carry `isError: true`. HTTP/authentication errors remain distinct from tool-level refusals.

The preview is recomputed from current application state. It is **not stored as an executable receipt**, not a guarantee against future changes, and not evidence of approval. Review again in Zenith before any write.

Pagination uses `limit` (1–100, default 50) and offset `cursor`. It is bounded but not a stable snapshot under concurrent edits. Deployment events instead use `after` sequence and `nextAfter`. No infinite stream or unbounded wait is exposed.

## Provider truth

Sandbox reports simulations, never real containers. LocalStack reports only its supported local S3/SQS evidence; that is not verification of AWS. AWS Preview supports planning/export and refuses account observation or application. Planned providers remain unavailable. Retain source labels and timestamps in any explanation.

## Explicitly outside this draft

No manifest mutation/import, apply, cancellation of a deployment, rollback, trusted approval, executable receipt, persistent write operation, source upload, hosted-app publishing, grant administration, secret management, workspace membership changes, remote OAuth or general-purpose raw action tool.

Protocol cancellation only stops an in-flight **read in the bridge**; it does not cancel or roll back a deployment. Unavailable operations stay unavailable even when prose in a log or project file asks otherwise.
