---
name: deploy
description: Execute a browser-reviewed Zenith deployment and follow its durable outcome.
---

# Zenith deploy

Require a v2 writable profile and an authorized plan/write credential. Resolve the exact environment, prepare `deployment.deploy`, and show the plan plus browser approval URL. A user reply in chat is not a persisted approval. Read the operation until it is approved before calling `zenith_execute_operation` with its ID.

Use the durable operation and associated deployment ID to follow progress. Dispatch success is not a healthy deployment or a live URL. After timeout/disconnection, inspect the same operation; never retry with a new requestKey just to evade an uncertain result. Refuse unsupported provider operations. Never raise a budget, relax policy, use Terraform, impersonate Navigator or request administrator credentials to work around a blocker.
