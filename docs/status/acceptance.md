# Acceptance Status

> Current status: maintained. Verification claims below describe the checked-in
> suites; consult the latest CI or local `pnpm verify` run for execution results.

Current automated baseline:

- Unit and adapter suites cover domain, application services, contracts, Matrix mapping, media, Pi runner, Postgres adapters, observability, and orchestration.
- Contract suites in `packages/testkit` cover job queue, session repository, schedule repository, execution repository, outbound repository, Pi runner, and media processor behavior against deterministic subjects.
- Deterministic system validation in `packages/testkit/src/system-validation.test.ts` covers assembled port-level flows without real sockets or external services.
- Opt-in PostgreSQL integration tests in `tests/integration/postgres` cover real migration application/rehearsal, real-adapter repository and queue contracts, row-lock claiming, duplicate inbound idempotency, outbound/job transaction rollback, due schedule claiming, and retention eligibility/sanitization behavior.
- Compose system tests in `tests/system/compose` cover the deployed service boundary, Matrix inbound/outbound paths through Continuwuity, restart recovery, retries, workspace lifecycle, isolation, and E2EE invitation handling. The real STT fixture remains explicitly opt-in.
- Static verification covers TypeScript, ESLint, Prettier, dependency boundaries, schema generation, and migration discovery.
- Catalog and collaboration suites cover specialist routing, bounded delegation,
  durable grants, scoped workspace writes, and durable child result artifacts.
- Plugin and control-plane suites cover repository-only plugin composition,
  retired-ID rejection, policy/resource/image agreement, and owner-approved
  Browser click/type continuation.

Run the full local verification suite:

```sh
pnpm verify
```

## Master Acceptance Matrix

| #   | Scenario                                                        | Automated status                                                                                           |
| --- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Text message produces a text response                           | Covered by deterministic system validation                                                                 |
| 2   | Image message produces an image-aware response                  | Covered at media/worker boundary with image preparation marker                                             |
| 3   | Voice note is transcribed and processed                         | Covered at media/worker boundary with transcript marker                                                    |
| 4   | Generated voice response is playable                            | Partially covered by media processor contract; real playable file check still needs media integration      |
| 5   | `/new` creates a different Pi session                           | Covered by session-routing unit tests                                                                      |
| 6   | Two Matrix threads maintain independent contexts                | Covered by deterministic system validation                                                                 |
| 7   | Reply linkage is preserved                                      | Covered by Matrix mapper tests and outbound mapping tests                                                  |
| 8   | Schedule CRUD through Pi tools works                            | Partially covered by schedule service and fake Pi tool marker; full Pi tool integration pending            |
| 9   | A due schedule executes once and sends a proactive message      | Covered by deterministic system validation                                                                 |
| 10  | Duplicate Matrix events do not duplicate Pi work                | Covered by deterministic system validation                                                                 |
| 11  | Duplicate outbound retries do not duplicate Matrix messages     | Covered by deterministic system validation via stable Matrix transaction ID                                |
| 12  | Worker crash during execution is recoverable                    | Covered by deterministic system validation and job queue contract                                          |
| 13  | Gateway crash after acceptance is recoverable                   | Covered by the Compose gateway-restart idempotency scenario                                                |
| 14  | Downtime-missed schedule follows configured policy              | Partially covered by schedule claiming/idempotency tests; downtime simulation pending                      |
| 15  | Seven-to-ten-day retention removes short-lived history          | Covered by retention unit/adapter tests and deterministic system validation                                |
| 16  | Memories and schedule definitions remain after cleanup          | Covered for schedules by deterministic system validation; memory workspace check pending Compose isolation |
| 17  | Pi cannot access an unmounted host directory                    | Covered by runtime security and Compose isolation checks                                                   |
| 18  | Pi cannot connect directly to PostgreSQL or Matrix              | Covered by runtime network isolation checks                                                                |
| 19  | Full Compose stack recovers after reboot                        | Compose restart recovery is covered; host reboot and boot-service behavior are post-release rehearsals     |
| 20  | Admin CLI can inspect, retry, cancel, and trigger work          | Partially covered by CLI command surface; end-to-end CLI workflows pending                                 |
| 21  | A specialist child can persist an inspectable result file       | Covered by collaboration, workspace-tool, and artifact tests with scoped writable grants                   |
| 22  | Browser mutations require owner approval and cannot be replayed | Covered by proposal, broker, privileged-handler, and Browser runtime tests                                 |
| 23  | Retired agent IDs remain readable but cannot execute            | Covered by catalog validation, durable-reference, and execution-admission tests                            |

## Remaining Real-Dependency Suites

These require infrastructure that is intentionally not started by the default unit suite or remain explicitly deferred:

- PostgreSQL migration rehearsal across supported public release versions;
  current integration tests cover the public baseline and additive migrations.
- Real Matrix account/room bootstrap verification beyond the automated deployment scenarios.
- Real filesystem retention integration with attachment files and orphan cleanup.
- Real FFmpeg/media adapter validation for playable generated audio.
- Operator-managed disaster-recovery rehearsal evidence for all dynamic
  workspace volumes.

The deterministic suite is designed to stay fast and reliable in normal CI. The remaining suites should run in a dedicated integration/Compose stage with captured logs and state snapshots.

Suite boundaries and verification guidance are documented in the [testing guide](../development/testing.md).
