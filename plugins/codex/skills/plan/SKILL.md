---
name: plan
description: Prepare an exact change or explain a non-executable Zenith deployment preview.
---

# Zenith plan

First inspect the selected target and capabilities. The v1 `zenith_plan_deploy` tool returns a non-executable preview and no receipt. For an executable v2 proposal use `zenith_prepare_change` with an allowed kind, explicit target and a stable requestKey. Reuse that key only for identical inputs. Attach an actual source repository/commit/PR when relevant; this is provenance, not authorization.

Present the exact plan, resource changes, estimated cost, blockers, expiry, digest and approval URL. Persisting a plan does not modify infrastructure. Every write requires browser review; never supply an agent-authored approval flag. Changed state or permissions invalidate execution; prepare a new reviewed intent rather than weakening a policy.
