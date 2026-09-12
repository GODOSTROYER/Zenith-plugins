---
name: plan
description: Review a Zenith deployment preview, including cost estimates, blockers, environment selection and approval requirements; never execute it.
---

# Review the next change

Use when the user wants to understand a proposed deployment before acting. Establish explicit context, check the capabilities and confirm the intended environment. Request the deployment preview only when the credential includes the plan scope.

Describe changes, estimated cost delta, warnings, and blockers separately. A preview has no executable receipt and is not human approval. This version cannot apply, approve, roll back, change policy, or publish source. Direct the user to Zenith's reviewed interface for those operations, without impersonating Navigator or applying exported Terraform as a workaround.

AWS Preview is plan/export only. Sandbox outcomes are simulated. LocalStack evidence covers the supported subset, not real AWS. Never infer verification from a green status alone.
