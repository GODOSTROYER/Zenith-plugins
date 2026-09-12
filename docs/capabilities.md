> **Legacy version-1 reference.** These restrictions and commands describe the retained v1 reader. For current v2 operations use [the control guide](control-v2.md) and [the current tool inventory](tool-reference.md).

# Tool and capability reference

[Home](../README.md) · [Architecture](architecture.md) · [Release gates](roadmap.md)

The bridge uses a fixed allowlist. Zenith supplies schemas and enforces permissions. Its reader is merged, but full application integration has not been verified here. Fixture tests do not prove database/provider behavior.

| Tool | Scope | Result / limit |
| --- | --- | --- |
| `zenith_get_context` | read | Explicit selection, member role and expiry |
| `zenith_get_capabilities` | read | Contract, provider descriptions and unavailable operations |
| `zenith_list_projects` | read | Authorized projects, bounded page |
| `zenith_get_project` | read | Metadata and estimated working-copy monthly cost |
| `zenith_get_manifest` | read | Redacted working/deployed manifest, not literal environment values |
| `zenith_list_environments` | read | Authorized project environments |
| `zenith_plan_deploy` | plan | Non-executable preview: `executable: false`, `receipt: null` |
| `zenith_list_deployments` | read | Deployment metadata for an authorized environment |
| `zenith_get_deployment` | read | Status, steps and conservatively redacted outputs |
| `zenith_get_events` | read | Bounded sequence-based events, excluding free-form logs |
| `zenith_get_findings` | read | Stored findings, no alert evaluation/delivery |
| `zenith_get_drift` | read | Supported provider read-back or explicit refusal |
| `zenith_export_project` | export | Redacted export data, no local file write or apply |

Every credential includes read; plan/export are optional. Catalog discovery does not authorize later calls independently. Request headers and arguments cannot expand the backend's credential scope. The client refuses non-allowlisted tools before credentials or network access and rejects conflicting write annotations.

## Result contract and workflows

Success requires text content plus `structuredContent` containing `data`, `contractVersion: 1` and `mode: "read-only"`. Failures use `isError: true`; HTTP/authentication and JSON-RPC failures remain separate. Dev.2 rejects malformed catalogs and incompatible result envelopes rather than presenting them as successful tool calls.

Five shared skills cover connect, inspect, plan, observe and export. No deploy skill pretends execution exists. A preview is recomputed from current state, not saved as an executable receipt and not proof of human approval. Continue in Zenith's reviewed UI for writes.

Lists use limit 1–100 (default 50) and offset cursor. Pages are bounded, not stable snapshots during concurrent edits. Events use after/nextAfter. There are no infinite streams or unbounded wait loops. Protocol cancellation aborts a bridge read; it cannot cancel or roll back a deployment.

## Provider truth and unavailable operations

Sandbox results are simulated. LocalStack evidence is limited to supported local S3/SQS resources, not AWS verification. AWS Preview supports plan/export only and refuses account observation or apply. Planned providers remain unavailable. Preserve source labels and timestamps.

No manifest mutation/import, apply, rollback, trusted approval, durable plan receipt, persistent write operation, source upload, hosted publishing, grant/membership administration, raw secret operation, remote OAuth or catch-all action tool is implemented. Private-app publishing will need Zenith's restricted source contract and app-owner grants, not an arbitrary-repository promise.
