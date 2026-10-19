# ADR 0015: Specialist delegation and durable outputs

## Status

Accepted.

## Context

The first catalog design used Brain and a coding role as its motivating
topology and left delegation, artifacts, and write leases for later. Jarvis is
now a personal assistant with several non-coding specialists. Delegated work
may produce reports too large for a synchronous response and may need to update
the same persistent workspace as its parent.

## Decision

Keep catalog-backed agents and runtime classes, but define the retained
topology around Planner, Brain, Browser, Document Analyzer, Scheduler, and
Router. Planner delegates to reviewed specialists; Router only selects a role
and is not an execution authority. New specialist roles use the same manifest
and policy model rather than hard-coded transport unions.

A child's effective authority is the intersection of the parent authority,
the child catalog policy, and its durable delegation grant. Delegation never
widens tools, capabilities, network, filesystem access, runtime class, or
resource limits. Independent workers claim durable child runs so a parent
waiting for a child does not consume the child's worker slot. Cancellation and
recovery operate over the run tree.

Children may write persistent workspace files when their policy and write
lease allow it. Long results may also be recorded as durable agent artifacts,
with producer and run provenance, so a later run can inspect them without
injecting their full contents into a model response. Write leases serialize
overlapping parent/child mutations; they are not an authorization grant.

Retired role IDs remain readable in historical rows but cannot start new work.
They are reserved against semantic reuse.

## Consequences

- Specialist prompts and shared image layers remain separate from authority.
- Text-only delegation remains available for small results, while persistent
  files and artifacts are first-class for larger work.
- Historical data does not require destructive rewriting when a role retires.
- Adding a role requires reviewed catalog, resource, delegation, and runtime
  policy changes with tests at each authority boundary.
