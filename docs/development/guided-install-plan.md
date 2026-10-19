# Guided first-install implementation plan

This plan turns the [first-install walkthrough](first-install-experience.md)
into one resumable operator journey. It builds on the existing setup state and
stage commands rather than creating a second deployment mechanism. The public
release checklist remains the source of truth for release acceptance.

## Implementation status

The interactive `pnpm jarvis:setup` path now collects and reviews configuration,
runs preflight, publishes artifacts, starts Matrix bootstrap, registers the owner
and brain accounts, guides the owner through Element recovery, persists the brain
recovery key, seals temporary registration, migrates, and starts production.
`--status` and the individual stage commands remain available for recovery.
The owner still makes the recovery and device-trust decisions in Element and
creates the first private room. The installer now reads and displays the
one-time first-user token from local homeserver logs; that differs from the
original hidden-token-entry recommendation below. The flow still needs the
fresh Linux and macOS release rehearsals recorded in the
[public release checklist](public-release-checklist.md).

## Recommended operator experience

The primary entry point is `pnpm jarvis:setup`. On a new terminal session it
collects and reviews configuration, runs preflight before writing persistent
state, and starts the guided journey. On a prepared deployment it reads the
protected state, reports the current stage and one exact next action, and
resumes. `pnpm jarvis:setup --status` gives the same guidance without changing
anything. Existing `--config ... --yes` and individual stage commands remain
available for reviewed automation and troubleshooting.

The journey is: preflight and configuration → protected environment → artifact
publication → private Matrix bootstrap → owner and brain account registration →
brain E2EE recovery → registration seal → database migration → production
startup → owner room invitation and first encrypted reply. Artifact publication
can run while the operator completes Matrix steps. The guide and command should
name exactly which stage may run in either order.

An operator must explicitly acknowledge the permanent Matrix server name,
private network exposure, external backup of each recovery key, and any Matrix
trust decision. The command must never claim those actions were verified from
the presence of an environment value alone.

## Owner account recommendation

Add **guided owner registration** as the preferred interactive path, subject to
an isolated test against the pinned Continuwuity image and Element X. The first
Continuwuity user is registered with a one-time token and becomes the first
administrator, as described in the [Continuwuity deployment guide](https://continuwuity.org/deploying/generic).
The existing brain registration helper already uses the Matrix
registration API, so its registration logic can be shared. The installer should
start the bootstrap homeserver, wait for readiness, then ask the operator for an
owner localpart, a password entered twice with hidden input, and the **first-user
token from homeserver logs**. It should register the owner, verify the returned
Matrix ID matches the configured server name, and persist only `MATRIX_OWNER_ID`
in the mode-0600 environment file. It should not retain the owner password or
owner access token. Afterward, the operator signs into Element X and completes
message backup using Element's separate recovery key. Explain that the Element
prompt may appear after a delay.

Do not generate an undisclosed owner password. If a generated password is
offered later, require a safe transfer and explicit confirmation that the
operator stored it before registration. Keep manual Element registration as a
fallback when the pinned homeserver/client combination does not support the
guided API flow. The installer must check for an existing first user before
registration and stop for reconciliation if a request may have succeeded but
its result was lost. Never automatically create another first user or infer
ownership from a localpart alone. The brain account uses the separate
`CONTINUWUITY_REGISTRATION_TOKEN`; prompts must identify each token's source
and purpose without printing either value.

## Work packages, in order

1. **Close the E2EE recovery gap.** Reproduce the native SDK exit after
   `createIdentity()` on the pinned image on Linux and macOS. Persist the brain
   recovery key through a protected handoff that survives a native crash; show
   it to the operator once for external backup. On ambiguous outcomes, report
   `identity may exist; inspect protected recovery state` and halt. Never retry
   `createIdentity()` automatically. Verify hidden-input confirmation restores
   terminal mode and exits. This is a gate for automating the E2EE stage.
2. **Extract a guided stage runner.** Give each stage prerequisites, a read-only
   probe, an action, a completion check, and specific recovery text. Reuse
   `setup-state.json`, `runSetupArtifactPublication`, `sealMatrixRegistration`,
   `runSetupMigration`, and `runSetupStart`. Reconcile recorded checkpoints with
   live state before acting. A checkpoint records verified completion, not a
   mere attempted command. Interrupted account registration and E2EE identity
   creation require a manual reconciliation state, never automatic replay.
3. **Strengthen preflight.** Move the Node 24 check to CLI startup so Node 22
   stops before configuration prompts or state creation. Check a working Docker
   daemon, Compose and BuildKit, host architecture, state path ownership and
   permissions, required loopback ports, Tailscale/private HTTPS reachability,
   and inference reachability from the host and relevant container network.
   Report an actionable fix for each failure. Keep the actual model request an
   explicit validation choice if it can incur cost.
4. **Guide Matrix bootstrap.** Run the existing bootstrap Compose service with
   the protected env file and canonical `jarvis` project. Guide private HTTPS
   setup and verify the Matrix API. Add the owner registration flow above and
   reuse a refactored brain registration helper to read its temporary token
   from protected state without asking the operator to copy it. Keep both
   account credentials out of logs, arguments, and shell history. Resume by
   checking account IDs and service state, with an explicit stop when API and
   local state disagree.
5. **Guide E2EE and trust.** Build/run the existing one-time brain bootstrap
   only after work package 1 passes. Require confirmation that the brain key
   was saved outside Jarvis. Prompt for Element recovery completion separately.
   Present device and master-key fingerprints for operator comparison; do not
   cross-sign an identity based only on data fetched through the same channel.
   Seal registration only after all required local fields and acknowledgements
   are present. Verify that a new registration is rejected after the production
   homeserver restart.
6. **Finish and document one path.** Drive the existing setup `--migrate` and
   `--start` implementations, then guide room creation, invitation, device
   verification, and first encrypted reply. Make the install guide the canonical
   journey; link the Matrix guide and runbook as stage detail and recovery
   references. Align their host support statement after fresh-host evidence.

## Acceptance and release gates

- A clean Node 22 run exits before persistent state or one-time credentials;
  Node 24 proceeds. Preflight failures name the failed dependency and next fix.
- An interrupted run resumes at the first unmet verified stage. It never
  silently rotates secrets, recreates accounts, or regenerates E2EE identity.
- The owner registration flow works against the pinned Continuwuity image; the
  first user is the intended admin, the owner signs in on Element X, and Element
  recovery completes. A simulated lost response stops for reconciliation.
- Brain and owner token prompts identify distinct sources. No token, password,
  access token, or recovery key appears in routine logs or status output.
- The E2EE process exits cleanly or produces a protected recoverable result;
  hidden input exits without Ctrl+C; an ambiguous identity outcome never
  triggers an automatic retry.
- Registration is sealed, migration and startup complete through the guided
  command, and a private encrypted room receives a first reply. Rehearse this
  from clean state on Linux and macOS, including the bootstrap-to-production
  restart and the supported boot/login service. Claim host support only for
  platforms that pass.

Use focused script tests for stage selection, secret redaction, lost-response
reconciliation, and terminal behavior; an isolated Compose registration test;
then the fresh-host release rehearsals. Update the public release checklist as
each gate is proven, rather than marking guidance alone as completion.
