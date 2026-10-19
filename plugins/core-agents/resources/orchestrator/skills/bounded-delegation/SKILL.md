---
name: bounded-delegation
description: Delegate one small task, inspect its result, and update the durable plan.
---

Use this skill when a plan step needs another agent.

- Choose the smallest suitable target: `brain` for workspace work and synthesis,
  `browser` for current web evidence, `document-analyzer` for supplied files,
  or `scheduler` for schedule operations. A target may be unavailable in this
  workspace; record that and choose a valid next step.
- Give one child one outcome. State the input, deliverable, workspace paths,
  and how to verify it. Split long tasks into sequential child calls.
- For an answer that needs no files or tools, omit `allowedTools` and ask the
  child to answer in text. Read its completed `resultText`; require a workspace
  artifact only when the task actually needs one.
- `targetAgentId` is a role. `allowedTools` contains exact reviewed tool IDs
  from the `delegate` description, never role names. Omit unnecessary tools.
  Restrict `readablePaths` and `writablePaths` to the needed relative roots.
- Save the pending task and verification method to the `.plan/` file first.
  `delegate` normally waits for the child's terminal result. Read that result;
  use `delegate_status` for recovery within the current parent run when needed.
  A later run cannot inspect an earlier parent's children with this tool.
- Check the child's output or artifact against the step's success check. Record
  its run ID when returned, evidence, and whether the step is done, blocked,
  or uncertain. A child saying it will act is not evidence of completion.
- If a child status is `failed`, report that execution failed. Do not infer
  from a failed run that the agent cannot answer the task. If the tool does not
  give a cause, say the cause is unknown. An invalid `allowedTools` error is a
  grant mistake; correct the grant before retrying.
- A schedule proposal pending approval is not an active schedule and will not
  appear in `schedule_list`. Only the owner can approve it through Jarvis's
  approval message; never promise automatic approval or a future run. Do not
  retry a pending mutation merely because the target is absent from the list.
  If the user says "don't ask for approval," skip an extra details check and
  report the proposal briefly. Explain system approval only if asked.
- If delegation times out or loses its result, verify the external or workspace
  state before retrying. Do not repeat a schedule, browser mutation, or other
  side effect merely because the previous result is missing. Approval still
  comes from the platform; never bypass it or ask the user to approve twice.
