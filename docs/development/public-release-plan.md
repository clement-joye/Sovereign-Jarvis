# Public release plan

## Status

Proposed on 2026-09-22. Implementation started on 2026-09-26. Phases 1–9 are
complete for the source-only release; phases 0 and 10 remain in progress.
Inventories, reproducible checks, known failures, and open decisions are tracked in the
[public release checklist](public-release-checklist.md). This plan prepares
Jarvis for its first public GitHub release. The public release establishes a
fresh compatibility baseline; private pre-release databases are intentionally
not upgradeable and must be reinstalled.

On 2026-10-13, the operator confirmed that voice messages, schedules, and
document analysis work on the current deployment. These are live feature smoke
checks. The operator confirmed the macOS 26.4 arm64 fresh install and checks on
2026-10-14, and Arch Linux x86-64 setup and checks on 2026-10-15. Those are the
first-release hosts; Ubuntu 24.04 validation is planned after release.
On 2026-10-14, the operator also confirmed Browser web fetch and Playwright
use, plus Orchestrator delegation, in the current Matrix room. On 2026-10-15,
the operator confirmed an approved Browser click/type action could not replay
from the same approval, and an interrupted Orchestrator task resumed from its
plan without repeating an uncertain action.
The operator later confirmed that an unmentioned scheduling request routes
through Router, a schedule can deliver its response in the originating Matrix
thread, and a leading agent mention switches the agent for that conversation.

## Objective

Publish Jarvis as a polished, secure, self-hosted personal assistant that a new
operator can understand, install, run, maintain, and troubleshoot without
reconstructing the project's development history.

The release should provide:

- a clean repository with no lint warnings or obsolete implementation records;
- an explicit MIT license and reviewed third-party provenance;
- a secure, resumable installation path on tested Arch Linux and macOS hosts;
- a small, consistent set of routine operator commands;
- a fresh PostgreSQL schema baseline without private upgrade compatibility;
- concise, thread-scoped Matrix progress and error notices;
- current documentation organized by operator, contributor, and architecture
  concerns; and
- verification evidence from Arch Linux and macOS installations.

Structured memory and new external integrations are not part of this release.

## Product decisions

- The public product name is **Jarvis**.
- The existing `@second-brain/*` npm scope may remain an internal implementation
  namespace for the first release. A package-scope rename is not release-critical.
- Arch Linux x86-64 and macOS 26.4 arm64 are the first-release production hosts
  through Docker Compose. Ubuntu 24.04 support is a later validation task.
  Platform-specific code should be limited primarily to systemd and launchd
  integration, state-directory conventions, and host preflight checks.
- Jarvis requires an OpenAI-compatible chat-completions API under `/v1`. It does
  not require or install one inference implementation. llama.cpp, OMLX, and
  other compatible servers are operator choices.
- Setup is interactive by default and has a strict non-interactive mode driven
  by explicit configuration.
- Delegation progress is visible in the originating Matrix thread. Notices are
  concise and rate-limited so they reassure the owner without becoming chat
  noise.
- The first public release uses a fresh database compatibility baseline. The
  owner accepts reinstalling the private deployment.
- Jarvis is released under the MIT license.
- The first public release publishes source and local build instructions, not
  prebuilt Jarvis Docker images. Publishing images later requires a separate
  bundled-component license, notice, and corresponding-source review.
- Dependabot is not required for the initial release.

## Required security and reliability invariants

Release polish must not weaken these properties:

- Brain Control remains the only PostgreSQL client.
- Runtime Provisioner remains the only Docker-socket owner.
- Model and media runtimes receive neither database credentials nor host
  administration authority.
- Matrix owner verification and private-network deployment remain fail-closed.
- Secrets never enter prompts, workspace files, ordinary logs, or command-line
  arguments by default.
- Setup never rotates an existing secret implicitly and never prints secret
  values in its summary.
- Destructive and external mutations remain parameter-bound, expiring,
  single-use, workspace-bound, idempotent where appropriate, and explicitly
  approved.
- Delegated children cannot exceed their parent, workspace binding, or reviewed
  catalog policy.
- Authorizers and executors agree on catalog, policy, resource, and immutable
  runtime-image identity.
- Inbound acceptance, job execution, outbound delivery, scheduling, and
  approval processing retain their idempotency and retry behavior.
- Plugins and model-controlled paths cannot install executable code.
- Published defaults expose services only on loopback or the documented private
  network boundary.

## Explicit non-goals

- Structured memory implementation.
- A public plugin marketplace or remote plugin installer.
- Installing or managing the operator's inference server.
- Supporting public internet exposure by default.
- Renaming every internal `second-brain`, workspace, V1, or package identifier.
- Preserving upgrades from private pre-release database schemas.
- Replacing Docker Compose with a second orchestration system.
- Adding integrations unrelated to release readiness.

## Phase 0: Freeze the release boundary and baseline evidence

1. Record the supported host, Docker, Node, pnpm, Matrix, and inference API
   versions or version ranges.
2. Record the current lint warnings, verification result, Compose build result,
   and fresh-install failures before refactoring.
3. Inventory operator-facing commands, environment variables, host paths,
   downloaded artifacts, container images, and network listeners.
4. Inventory repository and Git-history secrets before adding public automation.
5. Decide the first supported Jarvis version and compatibility statement.

Deliverable: a short release checklist linked from the pull request or release
tracking issue, containing reproducible commands and known baseline failures.

Acceptance:

- The supported public surface is explicit.
- Failures are recorded rather than hidden by cleanup.
- No secret or private deployment artifact is included in the release branch or
  its public history.

## Phase 1: Licensing and third-party provenance

1. Add the MIT `LICENSE` at the repository root with the chosen copyright
   holder and year.
2. Add consistent license metadata to the root and workspace packages where it
   is meaningful, without publishing private workspace packages accidentally.
3. Generate a reproducible production-dependency license inventory from the
   frozen install and deployed runtime dependency closures.
4. Add `THIRD_PARTY_NOTICES.md` for required attribution and provenance.
5. Verify and document the exact source, revision or immutable version,
   checksum, and license for:
   - vendored Pi profile resources;
   - the Whisper model;
   - the selected Piper voice and configuration;
   - Playwright/Chromium runtime assets;
   - PostgreSQL and Continuwuity images; and
   - optional Loki, Alloy, Prometheus, and Grafana images.
6. Add a verification check that rejects missing or explicitly disallowed
   dependency licenses while allowing a reviewed exception list.

Acceptance:

- GitHub visitors receive explicit permission to use, modify, and redistribute
  Jarvis under MIT.
- Every distributed or automatically downloaded third-party artifact has
  reviewable provenance and licensing information.
- The repository does not imply that model, voice, or container licenses are
  covered by Jarvis's MIT license.

## Phase 2: Establish the fresh public database baseline

This phase is intentionally breaking for private pre-release installations.

1. Derive the complete final schema produced by migrations `0001` through
   `0032`, including every active table, index, foreign key, check constraint,
   default, and schema ledger invariant.
2. Replace the private migration chain with `0001_public_baseline.sql`.
3. Set the public schema ledger to migration 1; future additive changes start at
   migration 2.
4. Remove upgrade-only data rewrites and compatibility behavior, including:
   - non-contiguous private-schema inference and repair;
   - implicit `workspace-default` column defaults and retirement backfills;
   - retired coding-agent data rewrites;
   - historical static agent allowlists; and
   - intermediate constraints superseded by the final schema.
5. Retain all final structures required by current repositories: workspaces and
   room bindings, sessions, schedules, jobs, agent runs, delegation grants,
   artifacts, write leases, root admissions, action proposals and policies,
   attachments, retention, execution identities, and schema metadata.
6. Decide the first-workspace bootstrap explicitly. Prefer creating it through
   the supported Matrix/setup flow rather than retaining a hidden legacy seed.
7. Simplify migration tooling so it:
   - installs the baseline on an empty database;
   - applies future ordered public migrations;
   - rejects unknown private/pre-baseline ledgers with a clear reinstall error;
   - rejects databases newer than the checkout; and
   - remains transactional and idempotent.
8. Replace historical migration-rehearsal tests with baseline creation,
   idempotency, constraint, and unsupported-ledger tests.

Do not remove `/v1` routes, `*V1` contract names, `schemaVersion: 1`, or plugin
SDK version 1. They are the current protocol versions and become the first
public compatibility contract.

Acceptance:

- A completely empty PostgreSQL instance reaches the complete current schema
  using the single baseline.
- First Matrix workspace creation and the first user message work without a
  seeded legacy workspace.
- A private legacy ledger fails early with an actionable reinstall message.
- PostgreSQL integration and Compose system tests pass against only the public
  baseline.

## Phase 3: Remove confirmed legacy and dead paths

1. Remove the unused `BRAIN_CONTROL_PI_DELEGATION_TOKEN` authorization path,
   `plannerDelegationToken`, and `legacyAuthorized` branches after focused
   authorization and red-team verification. Signed run authorization remains
   the only delegation authority.
2. Remove positional compatibility constructors only after proving that all
   production and test call sites use the current option-object forms.
3. Remove `scripts/runtime/vendor-pi-local-profile.mjs` after preserving its
   upstream revision and archive digest in profile provenance documentation.
4. Decide the boot-service scripts as one supported feature:
   - document and test the systemd/launchd installer and wrappers; or
   - remove all of them and document manual startup.
5. Keep measurement, verification, plugin, recovery, migration, catalog, and
   runtime-profile scripts that have an active command, test, or release
   consumer.
6. Keep `plugins/retired-identifiers.json` to prevent unsafe semantic reuse,
   even though the public database starts empty.
7. Evaluate stale compatibility identifiers such as `code-project` separately.
   If renamed, introduce a deliberate public identifier everywhere before the
   release; do not perform a partial search-and-replace.

Acceptance:

- No undocumented compatibility credential can bypass scoped run authority.
- Every remaining host-mutating script is documented and supported.
- Every remaining script has a caller, operator purpose, or test purpose.

## Phase 4: Eliminate lint warnings without suppressions

Bring `pnpm lint` from ten warnings to zero without disabling rules, adding
blanket ignores, or weakening thresholds.

Planned refactors:

1. Split run-authorization claim parsing and expectation matching into small,
   fail-closed helpers.
2. Decompose Brain Control bootstrap catalog/storage compatibility composition.
3. Extract Brain Worker dependency construction and polling lifecycle from its
   main function.
4. Replace five-parameter delegated-run and runtime-container functions with
   explicit input objects.
5. Remove or isolate legacy constructor paths in the agent-run handler and
   runtime provisioner.
6. Extract focused projections/compilers from the platform catalog compiler.
7. Split PostgreSQL schema interfaces into domain-focused files while retaining
   one assembled database type.

Run authorization, catalog compilation, and provisioning refactors require
focused security tests before general verification.

Acceptance:

- `pnpm lint` reports zero errors and zero warnings.
- No lint rule or threshold was weakened to obtain the result.
- Authorization denial, identity matching, catalog digest, and runtime policy
  tests continue to fail closed.

## Phase 5: Normalize public naming and operator vocabulary

1. Use **Jarvis** consistently in the README, documentation titles, setup
   output, logs intended for operators, service-installation descriptions, and
   release assets.
2. Retain `@second-brain/*` temporarily as the documented internal package
   namespace unless a separate full namespace migration is approved.
3. Establish and use this glossary:
   - **platform catalog**: reviewed policy and plugin composition artifact;
   - **runtime profile**: runtime image, model, and resource artifact; and
   - **deployment release**: the coordinated application images, schema,
     catalog, and runtime profile.
4. Split worker role from worker instance identity. Introduce a clear service
   role setting and keep lease-owner IDs unique per process. Provide a bounded
   compatibility alias only if still needed before the public baseline.
5. Hide host-directory, container-path, and generated-secret variables behind
   setup state instead of renaming every internal environment contract.
6. Clearly distinguish the Pi runner/provider implementation setting from the
   reviewed model-provider identifier.

Acceptance:

- A new operator sees one product name and one vocabulary across installation,
  routine commands, logs, and documentation.
- Worker instance identity remains unique and safe for leases.
- Internal namespace retention is explicit rather than accidental.

## Phase 6: Implement secure, resumable setup

Add a thin setup command, tentatively `pnpm jarvis:setup`, built on current
Compose and release scripts rather than duplicating them.

### Interactive behavior

Running `pnpm jarvis:setup` without arguments starts this flow in a terminal.
Without a terminal, setup prints usage and requires an explicit configuration
file with `--yes`.

1. Preflight Node, Corepack, pnpm, Docker, Docker Compose, BuildKit, supported
   architecture, writable state paths, and required ports.
2. Explain and collect only choices that cannot be inferred safely:
   - permanent Matrix server name;
   - owner and assistant account/bootstrap information;
   - OpenAI-compatible inference base URL;
   - API key or explicitly credential-free local endpoint;
   - provider and model identifiers;
   - state-directory location;
   - optional Browser, observability, and boot-service choices; and
   - private-network exposure confirmation.
3. Show a redacted summary and require confirmation before mutation.
4. Create the production environment file atomically with mode `0600`.
5. Preserve existing non-placeholder values and refuse implicit rotation.
6. Generate internal secrets with Node `crypto.randomBytes`, including database,
   provisioner, run-authorization, worker-collaboration, and temporary Matrix
   registration secrets.
7. Create runtime-profile and platform-catalog state directories using
   platform conventions, with an explicit override.
8. Validate Compose and the inference endpoint, while allowing compatible
   servers that omit optional `/v1/models` discovery.
9. Guide or execute Matrix bootstrap, E2EE trust, runtime-profile publication,
   baseline migration, application startup, and first health checks as named,
   resumable stages.
10. Disable temporary Matrix registration after account bootstrap.
11. Print only routine next commands and recovery guidance, never secret values.

### Platform defaults

- Linux state root: `${XDG_STATE_HOME:-$HOME/.local/state}/jarvis`.
- macOS state root: `$HOME/Library/Application Support/Jarvis`.
- All published ports remain loopback/private by default.
- Inference presets may populate examples for llama.cpp, OMLX, or a generic
  OpenAI-compatible endpoint, but must not alter the protocol contract.

### Non-interactive behavior

Support an explicit configuration file or equivalent structured input. Missing
identity, model, credential, or exposure decisions are errors; non-interactive
mode must not guess them.

Acceptance:

- Setup is idempotent and resumable after interruption.
- Re-running setup does not rotate secrets or recreate identities.
- Linux and macOS reach the same Compose/runtime/catalog result.
- Secrets do not appear in stdout, process arguments, generated docs, or Git.
- A failed stage reports one actionable recovery command.

## Phase 7: Add a small routine operator interface

Add memorable wrappers such as:

```text
pnpm jarvis:start
pnpm jarvis:stop
pnpm jarvis:status
pnpm jarvis:logs
pnpm jarvis:update
pnpm jarvis:backup
pnpm jarvis:restore
```

Requirements:

- Commands consume setup state instead of asking operators to repeat long
  Compose arguments.
- `update` distinguishes application releases, runtime-profile updates, and
  resource-only updates and warns before interrupting active runtimes.
- `status` reports service health, current catalog/runtime identity, database
  migration level, and actionable degraded states without exposing secrets.
- Backup and restore cover PostgreSQL plus release-managed catalog/profile
  artifacts and document what is not included.
- Startup integration has generated-file tests for systemd on Linux and
  launchd on macOS. Real reboot/login behavior is post-release acceptance work;
  manual `pnpm jarvis:start` is the validated startup path.

Acceptance:

- Routine operation does not require copying commands from the long runbook.
- Destructive commands require explicit confirmation and identify recoverability.
- Linux and macOS command behavior is equivalent except for host service
  registration.

## Phase 8: Add concise Matrix activity and error notices

1. Extend the outbound contract with an explicit semantic presentation such as
   `assistant`, `notice`, and `error`; do not infer presentation from Markdown.
2. Render routine system activity as Matrix `m.notice` with a plain-text body and
   safe formatted HTML. Render errors as regular messages so they remain visible.
3. Persist and deliver notices through the existing idempotent outbound path.
4. Carry the originating conversation and thread through root and delegated
   activity so notices cannot leak into another room or thread.
5. Emit an immediate delegation notice, for example:
   - *Delegating to Browser…*
   - *Delegating to Browser and Document Analyzer…*
6. Emit one delayed progress notice only after a reviewed threshold (initially
   30–45 seconds), for example:
   - *Browser is still working…*
   - *2 delegated tasks are still running…*
7. Emit a concise failure notice when the parent cannot recover. Do not emit a
   redundant completion notice when the final assistant response immediately
   follows.
8. Exclude activity notices from model conversation history.
9. Map known user-facing failures to short safe messages. Keep stack traces,
   HTTP bodies, internal IDs, and detailed causes in structured logs with a
   correlation identifier.
10. Rate-limit and deduplicate notices across retries.
11. Include a core `orchestrator` agent for multi-step work. It keeps a compact
    plan under the workspace's `.plan/`, delegates bounded tasks sequentially,
    checkpoints verified outcomes, and resumes safely after an interrupted run.

Acceptance:

- Delegation visibly reassures the owner during long work without flooding the
  room.
- Notices appear only in the originating thread.
- Mobile clients receive clear plain text; capable clients receive restrained
  italic formatting.
- Retried jobs do not duplicate progress or failure notices.
- No delegated prompt, secret, stack trace, or internal identifier is exposed.
- A later orchestrator turn can locate its plan and distinguish completed,
  pending, and uncertain actions without repeating an unverified side effect.

## Phase 9: Rewrite and prune documentation

### Public documentation shape

1. `README.md`: product, supported platforms, security boundary, short setup,
   routine commands, screenshots/demo, and links onward.
2. `docs/getting-started/install.md`: one complete installation path and its
   expected outputs.
3. `docs/operations/daily-commands.md`: start, stop, status, logs, update,
   backup, and restore.
4. Maintenance documentation: upgrades, schema baseline, secret rotation,
   models, Matrix trust/recovery, observability, and boot services.
5. Separate contributor, plugin-authoring, architecture, and security material.

### Remove or relocate

- Remove completed repository-cleanup plan and inventory documents after this
  release plan supersedes them.
- Remove the archived synchronous-delegation plan after confirming its durable
  rationale exists in ADR 0015.
- Keep ADRs, including superseded ADRs, as explicit architectural history.
- Move the memory-domain discussion to `docs/proposals/` with a prominent
  unimplemented status, or omit it from the initial public release.
- Remove stale private roadmap entries, tickets, commands, screenshots, and
  examples.
- Regenerate owned documentation and schemas using their source commands.

Correct known inconsistencies:

- The environment template and installation guide must list the same required
  inputs.
- Remove obsolete manual Whisper provisioning instructions when Compose owns
  verified model download.
- Provide reviewed image/default provenance rather than asking beginners to
  invent pins.
- Move contributor-only `pnpm verify` out of the first-run happy path.
- Document every retained host-mutating script.

Acceptance:

- A new operator can install and perform routine maintenance without reading
  contributor or architectural history documents.
- Every documented command exists and is exercised by a check or smoke test.
- Link, generated-document, schema, and command-reference checks pass.

## Phase 10: Public repository and release hardening

1. Add or finalize:
   - `CONTRIBUTING.md`;
   - `SECURITY.md` with private vulnerability-reporting instructions;
   - support and version policy;
   - issue and pull-request templates only where they reduce ambiguity; and
   - a release checklist.
2. Configure CI to run the appropriate static, unit, contract, documentation,
   schema, and Compose checks. Keep infrastructure-heavy suites explicit and
   reproducible.
3. Add secret scanning for the working tree and Git history before publication.
4. Verify ignored environment, state, model, catalog, runtime, backup, media,
   Matrix crypto, and database artifacts cannot be committed accidentally.
5. Produce a private-data-free screenshot or short demonstration.
6. Build all production images from a clean checkout and record their inputs.
7. Rehearse backup and restore.
8. Consolidate the recorded Arch Linux and macOS installation evidence for the
   release source snapshot.
9. Exercise the first Matrix message, media, scheduling, Browser observation,
   approved Browser mutation, delegation progress, failure presentation,
   restart, backup, and restore paths. Rehearse live update after release.
10. Run the complete release verification suite and record any intentionally
    external/manual checks.

Acceptance:

- A clean clone contains everything needed for the documented installation.
- CI has zero lint warnings and no stale generated artifacts.
- No secret or private data exists in the published Git history.
- Fresh Arch Linux and macOS installations reach a healthy system and complete a
  first Matrix conversation.
- Backup restoration has been operator-confirmed on both hosts. Live update and
  automated boot behavior remain post-release acceptance work.

## Cross-phase risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Schema squash omits a final constraint or index | Generate and compare final schemas; run repository, integration, and Compose tests against an empty database |
| Removing the default workspace breaks first-room routing | Make workspace creation an explicit setup/Matrix bootstrap acceptance test |
| Setup rotates or leaks secrets | Create-only atomic writes, mode `0600`, redacted output, explicit rotation commands |
| Matrix automation creates an irreversible wrong identity | Explain permanent server-name impact and require confirmation before bootstrap |
| Authorization cleanup weakens delegation boundaries | Remove only the legacy bearer path; retain scoped run authorization and red-team tests |
| Naming changes break persisted or release identities | Limit public naming cleanup; migrate durable identifiers deliberately or defer them |
| macOS and Linux behavior diverge | Share core setup logic and isolate only host-service/state-path adapters |
| Inference presets become vendor coupling | Keep the contract generic OpenAI `/v1`; presets only supply configuration examples |
| Activity notices leak or spam | Persist origin scope, use `m.notice`, redact content, deduplicate retries, and rate-limit delayed notices |
| License assumptions are incorrect for models/images | Record exact artifact provenance and separate third-party terms from Jarvis's MIT license |
| Installer duplicates orchestration logic | Keep wrappers thin and delegate to Compose and reviewed release scripts |

## Final release gate

The repository is ready to publish only when all of the following are true:

- MIT license and third-party notices are present and verified.
- A single public baseline creates the complete database from empty state.
- Private/pre-baseline databases fail with an explicit reinstall message.
- `pnpm lint` produces no warnings.
- Repository verification and required integration/system suites pass.
- Installation succeeds from a clean clone on Arch Linux and macOS.
- Setup is resumable and does not leak or rotate secrets.
- First message, delegation progress, Browser approval, scheduling, media,
  restart, backup, and restore scenarios have release evidence. Live update and
  automated boot are documented as unverified and deferred.
- Public documentation contains no completed internal plans, private tickets,
  stale commands, or unsupported claims.
- Git working tree and full public history pass secret/private-data review.
- The tagged release identifies supported versions, external prerequisites,
  known limitations, and recovery paths.
