---
name: rollback
description: Prepare and execute an exact retained Zenith deployment or hosted-app rollback.
---

# Zenith rollback

Resolve authorized revision/release IDs rather than guessing. For infrastructure use `deployment.rollback` with target and revisionId; for hosted code use `app.rollback` with appId and releaseId, preserving app-owner scope. Explain what is and is not restored, current provider/policy blockers and the reviewed plan.

Obtain browser approval and execute the resulting operation once. Inspect actual deployment/job evidence afterwards; neither a successful request nor a disconnected client proves recovery. Do not mutate working source as a substitute for the backend's retained-revision operation.
