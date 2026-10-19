# Public release execution guide

Use this guide to close the unchecked items in the
[public release checklist](public-release-checklist.md). That checklist is the
source of truth for release status; this guide gives an execution order and a
place to record evidence. The first release is **source-only**. The operator
confirms the macOS 26.4 arm64 install and checks are complete. Arch Linux
x86-64 setup and backup creation were operator-confirmed on 2026-10-15. After
`73c0b9c`, the operator also confirmed the delegation worker running. The
operator reports successful
backup and restore on macOS and Arch, and accepts these as the first-release
restore gate. Ubuntu 24.04, live update, and automated boot validation are
post-release tasks. The operator also confirmed the first encrypted reply,
media, due schedule, Browser approval, delegation, and reply after restart on
both selected hosts.

The owner reported successful voice-message handling, schedule interaction,
and document analysis on the current deployment on 2026-10-13. Record those as
current-deployment smoke evidence. Repeat the relevant checks on both release
hosts before closing the fresh-host gates.

## Before starting

1. Use test accounts, a private test room, and disposable test data. Use a
   separate Docker host or daemon for restore and disruptive update tests;
   `pnpm jarvis:restore` stops the stack and overwrites its PostgreSQL database
   and release artifacts. Do not run it against the live deployment.
2. Keep an evidence directory **outside** the source checkout and public
   repository. Record the tested source commit, date, host/architecture, exact
   tool versions, command result, and any redacted logs or screenshots for each
   gate. Keep credentials, recovery keys, Matrix tokens, private messages, and
   protected environment files out of evidence.
3. Finish and review the intended source changes before taking a release
   snapshot. Check for modified and untracked files; a copy of `HEAD` alone
   omits any intended uncommitted work. Follow the
   [public repository handoff](public-repository-handoff.md).
4. Use Node.js 24 or newer and pinned pnpm 11.5.0. Run commands from the
   checkout on the host being tested unless a step says otherwise.

Suggested evidence record for each result:

| Field | Record |
| --- | --- |
| Gate and host | Checklist item; Arch Linux x86-64 or macOS 26.4 arm64 |
| Source and tools | Commit; Node, pnpm, Docker Engine/Desktop, Compose, Buildx versions |
| Action | Exact command or manual action; date and time |
| Result | Pass/fail, expected versus observed behavior, redacted evidence path |
| Follow-up | Issue/fix and the rerun result, or `none` |

## 1. Review source-only provenance and licensing (phase 1)

Phase 1 is complete for a source-only release. Review the final
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md),
[container image provenance](container-image-provenance.md), and the
[phase 1 checklist](public-release-checklist.md#phase-1-progress) together.
They record pinned artifact identities, source and license references, and
specific limits where publisher build records or complete bundled notices are
unavailable. Keep those limits in the release statement. Jarvis runtime images
are built locally and are not published by this release; publishing them later
requires separate evidence closure. Optional observability images are outside
the fixed first-release image set.

The macOS 26.4 arm64 and Arch Linux x86-64 installations and checks are
operator-confirmed. The separate macOS 15 CI smoke job is not a supported-host
target for this release.

## 2. Prepare and scan the public source snapshot (phases 0 and 10)

1. Review `git status --short`, `git ls-files --cached`, and
   `git ls-files --others --exclude-standard` in the current checkout. Decide
   which modified and untracked source files belong in the release. Inspect
   ignored path **names** with
   `git ls-files --others --ignored --exclude-standard`; exclude all protected
   state and local build outputs.
2. Create a new, private staging repository from the reviewed tracked and
   non-ignored source snapshot using the
   [handoff procedure](public-repository-handoff.md). Do not copy the old
   `.git` directory, import its refs, or copy ignored state. Inspect the staged
   file list before making the new repository's initial commit.
3. With pinned Gitleaks v8.30.0, scan the **copied source** before committing.
   Stage only the reviewed files, make the new repository's initial commit,
   then scan its **new history**. Use redacted
   reports outside the repository:

   ```sh
   gitleaks dir --redact --no-banner \
     --report-format json \
     --report-path /tmp/jarvis-gitleaks-files.json .
   ```

   For the history scan, the checklist gives:

   ```sh
   gitleaks git --redact --no-banner --log-opts="--all" \
     --report-format json \
     --report-path /tmp/jarvis-gitleaks.json .
   ```

   Also review filenames and absolute-path references to `/home/`, `/Users/`,
   and `/root/` in both copied files and new history. Classify findings by
   detector/path/commit metadata without putting matching secret values in
   reports or chat. Correct any real finding and rescan. The old private
   repository's history scan does not prove the new snapshot is clean.
4. In that committed new repository, run `pnpm install --frozen-lockfile` and
   `pnpm verify` with Node 24 and pnpm 11.5.0. The initial commit is required:
   the runtime release check needs a Git revision, and catalog compilation
   reads tracked plugin resources. Fix source problems in the reviewed
   snapshot, then repeat the affected scans and checks.
5. Record the final public commit and scan results in the release checklist.
   Keep the staging repository private until all release gates pass.

## 3. Consolidate fresh-install evidence on both hosts (phases 0, 6, and 10)

Consolidate the macOS 26.4 arm64 and Arch Linux x86-64 installation records for
the reviewed source snapshot. Both installs are operator-confirmed. If release
fixes change the snapshot, repeat affected checks on the host(s).

1. Record OS version, architecture, and tool versions:

   ```sh
   uname -a
   # Linux: cat /etc/os-release
   # macOS: sw_vers
   node --version
   pnpm --version
   docker version
   docker compose version
   docker buildx version
   ```

2. Use a clean checkout with a new state root and no old Matrix/PostgreSQL
   volumes. Follow [Install Jarvis](../getting-started/install.md):

   ```sh
   corepack enable
   pnpm install --frozen-lockfile
   pnpm jarvis:setup
   ```

   Setup should guide protected preparation, artifact publication, Matrix
   bootstrap, account creation, registration sealing, migration, and startup.
   `pnpm jarvis:setup --status` must show completed stages without revealing
   credentials. If guided setup pauses, follow the stage-specific recovery
   steps in [Matrix bootstrap](../getting-started/matrix-bootstrap.md), then
   resume setup. Record each checkpoint, including the bootstrap-to-production
   restart boundary.
3. In the pinned Element client(s) selected for release, save the owner
   recovery key and separate brain recovery key in a password manager. Verify
   device trust in Element, create a private room, invite the brain account,
   and obtain its first encrypted reply. Do not copy keys into evidence.
4. Confirm new Matrix registration is sealed and stays sealed after the
   bootstrap-to-production restart. Confirm all production services are
   healthy with `pnpm jarvis:status`. Record failures and rerun the entire
   affected stage after fixing them.
5. Build the release images on that host and run `pnpm verify`,
   `pnpm test:integration:postgres`, and `pnpm test:system:compose`. Record
   pass/fail, skipped optional fixtures, image identities, and any host-specific
   dependency/build issues. The real speech fixture is opt-in; see the
   [Compose system tests](../../tests/system/compose/README.md) for its inputs.

Publish the observed OS and Docker Engine/Desktop, Compose, and Buildx versions
for these hosts. Do not claim an older minimum-version floor without evidence.

## 4. Exercise the real Matrix flows on **each** host (phases 8 and 10)

Use the owner account and the private test room from step 3. Capture redacted
client evidence and the matching service result. Wait for the actual scheduled
time or work completion before marking a flow as passed.

1. Send a plain message; confirm one encrypted reply in the same room. Start
   two threads and send different requests; confirm replies and notices stay
   in their originating threads. Use `/new` and verify a fresh conversation
   context if it is part of the chosen acceptance set.
2. Send a test image and a document; ask Jarvis to identify a harmless detail
   from each. Send a short voice note and verify transcription/response. Ask
   for a generated voice response and play the delivered file in the client.
   The last case remains a separate acceptance gap in
   [acceptance status](../status/acceptance.md).
3. Create a one-time schedule a few minutes ahead. Reply **directly to its
   approval message** with `/yes`; verify one successful creation result, an
   active schedule, exactly one due execution, and one proactive Matrix
   message. Repeat with `/no` and verify no schedule is created. For the
   missed-run case, use an isolated test deployment: stop it before a due time,
   restart it afterward, and confirm its configured missed-run policy without
   duplicate delivery.
4. Follow the [Browser agent guide](../operations/browser-agent.md) to enable
   Browser in the workspace. Verify observation on a public test page. Ask for
   one harmless click or type action, approve its dedicated prompt with a
   direct `/yes` reply, and confirm it executes once. Repeat with `/no` and
   confirm no action occurs; a second `/yes` to the consumed prompt must not
   replay it. Use a page/account prepared for the test, not a real purchase or
   external mutation.
5. Use the reviewed Orchestrator agent to delegate to a specialist. Confirm the
   immediate notice and final answer stay in the originating thread. For a run
   lasting over 35 seconds, confirm the single delayed progress notice appears
   there. Trigger a controlled terminal failure in the isolated test setup and
   confirm one concise failure notice without internal IDs or duplicates.
6. Restart the application services and repeat a message and one schedule
   check. Record whether accepted work and outbound delivery recover without
   duplicate messages. Threaded notice delivery was already operator-confirmed
   in a real Matrix client.

## 5. Rehearse operator commands and recovery on **each** host (phases 7 and 9)

Use a separate Docker host or daemon for destructive operator rehearsals, with
a custom absolute state root. The public operator CLI uses the fixed Compose
project name `jarvis`; changing only the state root does not isolate its Docker
volumes or services from another Jarvis deployment on the same daemon. Follow
[Daily commands](../operations/daily-commands.md)
and [Maintenance and recovery](../operations/maintenance.md). Standard Jarvis
backups contain PostgreSQL and release artifacts; they do **not** contain
Matrix data, Matrix crypto, media, or recovery keys.

1. Run `pnpm jarvis:status`, inspect redacted output from
   `pnpm jarvis:logs --tail 200`, then run `pnpm jarvis:stop` and
   `pnpm jarvis:start`. Confirm expected service state after each action.
2. Run `pnpm jarvis:backup`; retain its path and check that `manifest.json`,
   `database.dump`, and the release-artifact directories exist with protected
   permissions. On the isolated deployment,
   create a known test schedule or record, mutate/delete it, then run
   `pnpm jarvis:restore /path/to/jarvis-backup` and type `RESTORE` only after
   confirming the selected backup. Confirm the PostgreSQL record and published
   catalog/runtime profile return to the backed-up state. Recheck service
   health. Rehearse Matrix data/crypto recovery separately if claiming full
   deployment recovery.
3. Correct any command or host-specific documentation discrepancy in the
   install, daily-command, or maintenance guides, then rerun that command.

The operator reports successful backup and restore on macOS and Arch, and
accepts that evidence for the first release. The exact commands, restored-data
checks, and isolation details were not supplied. The isolated Arch Compose
restore fixture additionally checks database and release-artifact recovery.

### Post-release host rehearsals

- With a known earlier public schema version, back up and run
  `pnpm jarvis:update application` from the candidate checkout. Check
  migration, image rebuild, service health, and preservation of test data.
  Separately check runtime and resource update modes without active agent work.
- Create the operator-owned runtime environment from
  [`jarvis-runtime.env.example`](../../deploy/compose/jarvis-runtime.env.example),
  configure inference and Docker paths, and run `pnpm jarvis:service:install`.
  Test Linux systemd startup after a reboot and macOS launchd startup after
  logout/login, including custom state roots and a Matrix reply.
- Rehearse Ubuntu 24.04 fresh installation and scenarios before adding it to
  the supported-host list.

## 6. Make the release decision

1. Link each result to its corresponding unchecked line in the
   [public release checklist](public-release-checklist.md). Include the tested
   commit and both host records. Mark a checkbox complete only after the
   specific evidence above passes; retain failures and their reruns.
2. Run final verification and security scans on the **actual** public snapshot
   and new history after the last change. Recheck the exact supported-version
   statement, [0.1.0 release notes](../getting-started/release-notes-0.1.0.md),
   third-party notices, and documented commands.
3. Publish/tag `0.1.0` only when every release gate is closed and the staged
   repository contains no private state. Use the tested commit as the release
   source; a later source change requires affected checks to be repeated.
