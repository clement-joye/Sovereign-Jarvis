# First-install experience: operator findings and recommendations

This is a historical walkthrough of the manual setup path that preceded the
guided installer. For current operator steps, use the
[installation guide](../getting-started/install.md); for remaining acceptance
work, use the [public release checklist](public-release-checklist.md).

It records observed friction and proposed work from a fresh Jarvis deployment
walkthrough; it does not change the release's security or architecture
boundaries.

The actionable sequence is in the [guided first-install implementation
plan](guided-install-plan.md).

## Walkthrough outcome

The deployment was completed on macOS from the documented setup, Matrix
bootstrap, and production runbook. PostgreSQL, Brain Control, Inference
Gateway, and Runtime Provisioner reported healthy; Brain Control returned
`ready`. The owner invited the brain account to a private room, and Jarvis
joined and replied successfully. This is useful macOS smoke evidence, not a
replacement for the fresh-host acceptance work in the release checklist.

The operator completed release verification, protected setup preparation,
artifact publication, Matrix account and E2EE bootstrap, registration sealing,
database migration, and production startup. The setup status command was useful
for resuming and confirming secret presence without revealing values.

## Friction observed

1. **The operator had to assemble the path across three documents.** Setup,
   Matrix bootstrap, and production startup were separate stages. It was not
   always clear which command came next or which completed stage could safely
   be resumed.
2. **The two Matrix registration tokens were easy to confuse.** The owner uses
   the one-time first-user token from homeserver logs; the brain helper asks
   for `CONTINUWUITY_REGISTRATION_TOKEN` from protected setup state. Exact
   naming is essential.
3. **Element's owner recovery prompt was delayed.** It appeared roughly a
   minute after account creation. The operator needed to choose message
   backup, save the Element recovery key, and confirm it. This key is distinct
   from the brain recovery key.
4. **Brain E2EE setup had a fragile one-time handoff.** The command printed the
   brain recovery key, then the Matrix SDK's native runtime panicked. The key
   was subsequently stored and confirmed present by setup status. Operators
   must not rerun identity creation after it may have succeeded.
5. **Recovery-key persistence appeared to hang after success.** The command
   printed that the key was written, but did not return to the shell until
   interrupted. The hidden-input helper now pauses stdin after restoring
   terminal mode; add a regression check that proves the interactive process
   exits cleanly.
6. **The Node requirement was easy to miss.** Node 22 emitted an unsupported
   engine warning where Node 24 is required. The warning did not prevent the
   command from proceeding.
7. **The supported-host story is inconsistent.** The install guide and release
   plan list Linux and macOS, while the production runbook says to use Linux or
   a VM. The deployment worked on this Mac through a successful room reply, but
   fresh-host acceptance is still required before making a broad support claim.

The Matrix guide now names the temporary token variable and describes the
delayed Element recovery prompt. Preserve those clarifications.

## Primary recommendations

### P0: Close the one-time E2EE reliability gap

Reproduce and resolve the native SDK panic on the supported Node/Docker
combinations, including macOS. Make the bootstrap command's result and recovery
instructions unambiguous if the native process exits after identity creation.
Never offer an automatic retry that could create a second identity. Keep the
brain recovery key protected, persist it reliably, and instruct the operator to
back it up externally before starting the gateway.

Add a regression check for the hidden recovery-key prompt: input remains hidden,
the secret is persisted only after confirmation, terminal mode is restored,
and the process exits without requiring Ctrl+C.

### P1: Make first install one guided, resumable journey

Use a single interactive installer as the primary path. It should run preflight
before writing state, report the current checkpoint and exact next action,
perform safe local stages, and pause explicitly for owner account creation,
Element recovery, and trust decisions. Resume from recorded checkpoints after
interruption. Keep structured config mode for reviewed non-interactive setup.

Preflight should fail early with an actionable message for unsupported Node
versions rather than allowing Node 22 to proceed with a warning. It should
check Docker/Compose/BuildKit, state-directory readiness, port conflicts,
private-network settings, and configured inference connectivity before costly
builds or one-time identity work.

Choose one canonical operator command path for migration and startup. The
current documentation describes setup-backed `--migrate`/`--start` stages as
well as direct Compose commands; keep lower-level commands available for
troubleshooting, but make the recommended path consistent across the install
guide and production runbook.

### P1: Reconcile and prove host support

This historical recommendation was superseded by the first-release host
decision. The supported hosts are Arch Linux x86-64 and macOS 26.4 arm64;
see the [installation guide](../getting-started/install.md) and
[release checklist](public-release-checklist.md) for the current evidence.
Ubuntu 24.04 and automated boot/login validation are post-release tasks.

## Acceptance criteria for the improvement

- A new operator can follow one primary guide/command path without guessing
  which stage or command comes next.
- Node 22 is rejected before setup state or one-time credentials are created;
  Node 24 is accepted with a clear version message.
- Token prompts identify the exact source and purpose without printing secret
  values. Owner and brain recovery keys are clearly distinguished.
- An interrupted install resumes from status/checkpoints and never repeats
  identity creation automatically.
- The E2EE bootstrap exits cleanly on supported environments, or reports a
  safe, specific recovery state if the native dependency fails.
- The hidden-input workflow persists confirmed input, restores terminal state,
  and exits normally.
- Fresh Linux and macOS deployments pass through a private-room invitation to
  a verified first reply, with host support claims matching the evidence.

## Related operator docs

- [Install Jarvis](../getting-started/install.md)
- [Matrix and Tailscale bootstrap](../getting-started/matrix-bootstrap.md)
- [Production runbook](../operations/production-runbook.md)
