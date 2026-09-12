---
name: promote
description: Promote an exact deployed revision into another authorized Zenith environment.
---

# Zenith promote

Inspect source and destination environments and choose the source's actual deployed revision. Use `deployment.promote` with destination target, sourceEnvironmentId and revisionId. The backend rejects stale source revisions and applies destination permissions, budgets, provider support and approval rules.

Present the exact source revision and destination plan for browser review. Do not copy a mutable working manifest or assume staging approval authorizes production. Execute the resulting approved operation and follow the destination deployment. Changes to either environment after preparation require a new plan.
