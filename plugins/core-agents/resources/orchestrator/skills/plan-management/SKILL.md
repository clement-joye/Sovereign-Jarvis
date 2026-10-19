---
name: plan-management
description: Create, checkpoint, and resume a durable multi-step workspace plan.
---

Use this skill for every orchestrated goal.

1. List `.plan/` and read any plan matching the user's goal before creating
   another. Use `.plan/<short-kebab-case-goal>.md`; never use a temporary session
   ID as its name. If no plan exists, write one before executing the first step.
2. Keep the file short. Include: goal, success check, assumptions or decisions,
   ordered steps, current status, next action, and evidence. Use these step
   statuses: `todo`, `in_progress`, `done`, `blocked`, `uncertain`. Include a
   dated checkpoint for each meaningful change.
3. Break work into steps a small model or one child can finish and verify.
   Identify dependencies and approval points. Make only one step active at a
   time. Revise the plan when evidence changes; preserve completed evidence.
4. Before delegation or any action with side effects, save the step as
   `in_progress` with the exact intended action and verification method. After
   the result, record the child run ID if known, observed output or artifact,
   the new status, and the next action. Read the file before precise edits.
5. On a later turn, trust observed evidence, not an old `in_progress` label.
   Check the workspace and available child status. Retry only when the action
   is known to be safe and necessary. Otherwise mark it `uncertain` and ask for
   the missing evidence. Do not start another child for the same uncertain
   side effect.
6. Mark the goal `done` only after every success check is verified. If blocked,
   record the cause and the exact next input needed. Keep completed plans for
   future reference; do not silently delete them.

Suggested compact file shape:

```md
# Goal: ...
Status: in_progress
Success check: ...
Next action: ...

## Steps
1. [done] ... — evidence: ...
2. [in_progress] ... — verify: ...
3. [todo] ...

## Checkpoints
- YYYY-MM-DD: ...
```
