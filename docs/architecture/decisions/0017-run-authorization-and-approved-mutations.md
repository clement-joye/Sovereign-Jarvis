# ADR 0017: Run authorization and approved mutations

## Status

Accepted.

## Context

The original generic authorization decision included a Git-specific proving
implementation. That capability has retired, while run-bound authorization,
durable approvals, scheduled mutations, Browser interaction, and future
privileged plugins still require the same independent enforcement boundary.
Catalog identity has also split into policy, resource, and executable image
identities so resource-only changes do not imply new executable authority.

## Decision

Brain Control derives each run's effective policy from durable workspace
state, the selected agent, enabled plugins, runtime ceilings, delegation
grants, emergency disables, and owner policy. It issues a short-lived signed
authorization that binds the run, workspace, agent-scoped tools, policy digest,
resource digest, immutable runtime image, broker operations, expiry, and call
ceilings. Authorizers and executors reject any mismatch; they never reconstruct
authority from current state for an old or incomplete run.

Long-lived credentials remain in privileged services. A provider operation
crosses a broker boundary with the run authorization and never exposes a
provider credential or general control-plane token to the agent.

Approved mutations use the generic durable proposal state machine. Each
proposal binds one canonical operation and parameter digest to its run,
workspace, agent, plugin, capability, approver, expiry, and idempotency key.
Only an authenticated owner decision can approve it, and consumption is
single-use. Conversational assent, prompt text, or a model-supplied Boolean is
not approval authority.

Browser remains observation-capable without mutation approval. Each approved
click or type action creates and consumes a separate owner proposal before the
privileged broker forwards that exact action to the isolated Browser runtime.
Schedule create, update, delete, and run-now operations use the same generic
approval mechanism. Retired capabilities cannot be executed even when their
historical proposals remain readable.

## Consequences

- Resource-only publication cannot widen tools or broker authority.
- Queued work and retained runtimes fail closed across policy, resource, or
  image disagreement.
- Privileged plugins can reuse one approval mechanism without inheriting a
  retired feature's implementation.
- Sensitive actions require an additional owner interaction and retain the
  intentional at-most-once crash tradeoff after approval consumption.
