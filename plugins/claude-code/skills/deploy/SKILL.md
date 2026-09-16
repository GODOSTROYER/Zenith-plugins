---
name: deploy
description: Execute a browser-reviewed Zenith deployment and follow its durable outcome. Phase 1 deployments are simulated.
---

# Zenith deploy

Require a v2 writable connection and an authorized plan/write credential — `zenith login` grants write only when the user ticked the `write` scope in the browser. Never raise a budget, relax policy, use Terraform, impersonate Navigator or request administrator credentials to work around a blocker. Refuse unsupported provider operations.

## The loop

1. `zenith_get_context`, then `zenith_list_projects` / `zenith_list_environments` for real IDs. Never invent one.
2. `zenith_prepare_change` with `kind:"deployment.deploy"`, an explicit `target`, and a stable `requestKey` you reuse on every retry of the *same* intent.
3. The result carries `reviewUrl` and `requiresBrowserApproval:true`. **Give the user that URL and stop.** A "yes" in this conversation is not an approval; it is not persisted and the server will refuse.
4. Poll `zenith_get_operation` until `phase` is `approved`. `rejected` ends the task.
5. `zenith_execute_operation` with the operation ID — once.
6. Poll `zenith_get_operation` for the deployment evidence and report status changes. `succeeded` means the dispatch succeeded, not that the infrastructure is healthy or that a URL is live.
7. If anything returns `outcome_uncertain`, **stop and report it.** Inspect the same operation. Do not prepare a new operation with a new `requestKey` to make the error go away.

## Approval and cancel

- Some environments need an administrator to approve the deployment itself. The agent never approves one. Call `zenith_get_handoff` with `task: "deploy.approve"`, the environment `target` and the `deploymentId`, and give the person the URL. `task: "operation.review"` with an `operationId` returns the review page for a proposal.
- To stop a deployment that is still running, prepare `kind: "deployment.cancel"` with the environment `target` and the `deploymentId`. It is reviewed like any other change. A cancel is not a rollback: report what state the environment was left in.
- `zenith_get_health` and `zenith_investigate` (see the `operate` skill) read the environment after a deployment. In phase 1 their results are simulated too.

## Phase 1 is simulation

The `sandbox` provider does not create cloud infrastructure. It simulates a deployment, and `zenith_get_capabilities` together with every drift and export result labels it. Say "simulated" when you report a result, and never present a sandbox URL as a live production endpoint or a simulated run as proof that a real deployment would succeed.

LocalStack and AWS are **not enabled yet**. If the user asks for a real AWS deploy, say it is not available yet rather than deploying to the sandbox and calling it AWS.

Saved-revision promotion requires the actual revision deployed in a different authorized source environment and respects the destination's policy; use project-level selection so both environments are within scope.
