# ADR 0011: One Matrix Room per Workspace in v2

## Status

Accepted.

## Context

The Phase 0 multi-workspace assessment
(`docs/architecture/overview.md`)
flagged a decision that had to be made before Phase 1 could finish: whether
the v2 design would allow a single workspace to bind to multiple Matrix
rooms. The recommendation was to model the binding table so future growth is
possible, but enforce a one-room-per-workspace constraint initially.

The reasoning behind that recommendation:

- A single workspace is one configuration, one template, one Pi workspace
  directory, one session state. Two rooms owning the same configuration
  surface immediately forces a "primary" decision on every read path
  (which conversation drives the conversation-default binding for a
  message whose thread root lives in the other room?).
- The current Matrix adapter authorizes one trusted owner
  (`MATRIX_OWNER_ID`). Two rooms per workspace would require per-room
  owner trust decisions that we have not built.
- Workspace-scoped state (sessions, schedules, jobs, outbounds) already
  carries a single `conversation_id` (the room address). The
  `session_bindings` row is `UNIQUE NULLS NOT DISTINCT (workspace_id,
conversation_id, thread_root_external_event_id, schedule_id)` after
  migration 0008; a one-room invariant keeps that constraint intuitive
  and prevents the second room from creating a competing binding.

The current schema in `brain_core.workspace_room_bindings` already supports
many-to-one because the primary key is `(workspace_id, room_id)` and only
`room_id` carries a UNIQUE constraint. That structural choice preserves
the ability to relax this decision later without a destructive migration.

## Decision

For v2, a workspace binds to exactly one Matrix room. The binding table's
shape is unchanged so future growth to many-to-one is purely an additive
change. The control plane rejects any second `bindRoom` call against an
active workspace with `LegacyWorkspaceRoomConflictError`.

## Consequences

- The Matrix gateway never has to choose between two rooms for the same
  workspace; `resolveRoom(roomId)` is a one-to-one lookup.
- `/workspace use <template>` and `/workspace confirm` only need to address
  one room; the wizard surface stays narrow.
- Schedule `destinationConversationId` is always exactly the one bound
  room; scheduled executions always reply to the right place without
  per-schedule configuration drift.
- The `SessionBindingActivateRequest` does not have to ask the caller to
  pick between multiple rooms.
- Future work that wants many-to-one (e.g. a workspace that owns a room
  and an associated sub-room for ephemeral work) is gated on a follow-up
  ADR. The data model can stay as-is; the application-level invariants
  (one default room, one schedule destination) are what change.

## Alternatives

- **Many-to-one from day one** — rejected because the gateway, session
  router, schedule service, and admin tooling would all have to learn
  about "primary vs secondary room" decisions before any second workspace
  exists to need them.
- **Many-to-many** — rejected because it removes the workspace's
  "this is one context" mental model and makes the `/workspace` command
  surface ambiguous.
- **One workspace per matrix account** — out of scope; the v2 plan
  explicitly defers multi-user administration.

## Revisit criteria

Revisit when (a) the trusted owner model grows beyond a single Matrix
user, or (b) the user requests ephemeral sub-rooms that should inherit
their parent's workspace context without a second onboarding round.
