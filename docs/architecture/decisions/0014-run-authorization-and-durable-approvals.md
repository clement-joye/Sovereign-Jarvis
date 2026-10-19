# ADR 0014: Run Authorization and Durable Approvals

## Status

Superseded by [ADR 0017](0017-run-authorization-and-approved-mutations.md).

The generic Phase 4 approval foundation and Browser mutation resume are
implemented. An approval authorizes one canonical click or type operation only;
it is not a permanent grant for a website. Browser's isolated bounded `/tmp`
scratch area is an independent runtime control. Broader risk-tiered or bounded
origin grants remain deferred; scheduled jobs must use a pre-authorized policy
or fail closed.

## Context

Agent prompts and tool schemas currently describe some authority boundaries,
but model-supplied identities, paths, capability names, and confirmation
Booleans are untrusted input. A value such as `confirmed: true` cannot prove
that the Matrix owner approved an external or destructive mutation. Long-lived
control or provider credentials exposed to an agent process can also be read
by arbitrary process tools regardless of prompt instructions.

Plugin extensibility would amplify both weaknesses unless run identity,
effective authority, credentials, and approvals are separated before generic
plugins are activated.

## Decision

Brain Control resolves an effective policy for each run from durable workspace
state, the selected agent definition, installed plugin bindings, runtime-class
ceilings, parent authority, delegation grants, platform emergency disables,
and relevant owner approvals. Model claims never broaden this intersection.

Each run receives a short-lived opaque authorization. Brain Control stores its
hash and durable claims: run, workspace, agent, catalog digest, exact broker
operations, expiry, and optional call ceilings. The raw token is carried only
in the private run request and broker client closures. It must not appear in an
environment variable, prompt, session, workspace, artifact, log, or durable
row. Brokers derive identity from the stored authorization and ignore
model-supplied identity fields. Completion, cancellation, timeout, catalog
replacement, or explicit revocation invalidates it.

Long-lived provider and external-service credentials remain in the privileged
service that uses them. Credentialed operations cross a broker boundary using
the run authorization; agents never receive the credential or a general
control-plane bearer token.

Durable approval is generic policy middleware reusable by arbitrary tools and
providers. Providers opt in declaratively per operation. Each reviewed
operation declares a minimum approval mode, initially `none | owner` (and
extensible later); user/workspace policy may strengthen that minimum but never
weaken it. A proposal is bound to the run, workspace, agent, plugin,
capability, operation, canonical parameter digest, approver, expiry, and
idempotency key.

The implemented service applies this strengthening-only workspace policy and
is backed by both in-memory and PostgreSQL repositories. Proposal creation is
idempotent, and decisions, expiry, and consumption use compare-and-swap (CAS)
state transitions with the complete binding check in the same durable
operation. Trusted Matrix `/yes` and `/no` replies to a dedicated, durably
bound approval prompt are the normal decision path. Only owner-authenticated
events may reach the decision service.

The model-facing proposal tool records the exact action, presents it in the
active chat, and suspends the operation. For `owner`, a trusted owner Matrix
reply decides it, with `/approve <code>` and `/reject <code>` retained as
explicit administrative fallbacks. Proposals expire after 24 hours. Approval authorization is consumed before the external
callback; retries cannot consume it twice. If the process crashes between
those steps, the action may be lost, but it will not be automatically replayed
with an unknown external outcome. This is an intentional at-most-once crash
tradeoff.

A model-supplied confirmation flag, conversational assent observed by the
model, prompt text, or tool retry is never approval authority.

Git mutation no longer accepts the legacy model-supplied `confirmed` Boolean;
all agent-run Git operations pass through the generic service. Reviewed Git
mutation floors remain owner-required, while workspace policy may strengthen
reviewed `none` operations such as status, pull, and add. Schedule create,
update, delete, and run-now operations use the same durable owner proposal;
agent-authorized enable/disable is represented by `schedule-update`.
Canonical catalog operation IDs are hyphenated, while runtime tool
authorization names retain underscores and are translated explicitly at the
boundary. Browser click/type requests create one owner-required proposal per
action. Once consumed, the privileged broker forwards the canonical action to
the live page in the workspace's isolated Browser runtime; it does not grant a
persistent interaction capability. Password/file input, ambiguous selectors,
lost page state, and automatic replay fail closed. The runtime retains only its
bounded `/tmp` scratch area for Playwright state and traces.

Run-tree cancellation revokes still-actionable proposals for each affected
workspace/run before the runtime receives its cancellation signal.

## Consequences

Tool clients need run-bound closures and broker endpoints need authorization,
approval, idempotency, and audit validation. This adds durable state and a
second Matrix interaction for sensitive actions, but makes the boundary
testable and reusable by arbitrary tools and future plugins.

Secretless local tools remain lightweight. Credentialed and destructive tools
cannot be implemented as arbitrary local extensions that bypass the broker.
The initial experience is deliberately fail-closed; narrowly reviewed approval
policies may be added later if real usage shows excessive approval fatigue.

## Alternatives

Trust `confirmed: true` or prompt instructions. A mistaken or injected model
can assert either and no independent owner event exists to audit.

Inject shared bearer tokens or provider keys into agent environments. Shell
and extension code can read and reuse them outside the intended operation.

Treat any recent owner message as approval. This is ambiguous and cannot bind
authorization to one exact operation and parameter set.

## Revisit Criteria

Revisit the explicit command syntax only if a conversational flow can prove
the same sender, proposal, parameter, expiry, single-use, and audit properties.
Revisit opaque tokens if a stronger workload-identity mechanism is available
without exposing reusable credentials to the model runtime.
