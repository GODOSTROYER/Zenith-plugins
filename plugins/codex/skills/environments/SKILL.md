---
name: environments
description: Create, clone and tune Zenith environments through reviewed proposals; loosening policy and deleting are browser hand-offs.
---

# Zenith environments

Use this when the user asks to add, clone, rename, move, budget or protect an environment.

Start with `zenith_get_context`, `zenith_list_projects` and `zenith_list_environments` to get real IDs. Check `preparationKinds` in `zenith_get_capabilities` before proposing a kind.

## Reviewed proposals

All of these go through `zenith_prepare_change`, then the browser review at `reviewUrl`, then one `zenith_execute_operation`, then `zenith_get_operation`.

| Kind | Target | Fields |
|---|---|---|
| `environment.create` | `{workspaceId, projectId}` | `name`, `class` (`sandbox`, `staging` or `production`), optional `connectionId`, `region`, `approvalRequired`, `budgetUsdMonthly` |
| `environment.clone` | `{workspaceId, projectId, environmentId}` | `name` |
| `environment.update` | the environment | optional `name`, `region` (administrator approval) |
| `environment.setBudget` | the environment | `budgetUsdMonthly` (administrator approval) |
| `environment.setConnection` | the environment | `connectionId` (administrator approval) |
| `environment.tightenPolicies` | the environment | `approvalRequired: true` and/or `allowStatefulDeletion: false` |

The project and environment always come from `target`. Never put them in other fields.

## Browser hand-offs

- The agent never proposes loosening a policy, such as turning approval off or allowing stateful deletion: it must not weaken the gate that reviews its own changes. Use `zenith_get_handoff` with `task: "environment.policies"` and give the person the URL.
- Deleting an environment is `zenith_get_handoff` with `task: "environment.delete"`.
- Never raise a budget or relax a policy to get past a blocked deployment. Report the blocker instead.

## Phase 1

A `sandbox` environment simulates deployments and creates no cloud infrastructure. Say "simulated" when you report results from it.
