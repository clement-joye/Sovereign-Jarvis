# Public release checklist

This checklist records the reproducible baseline for the first public Jarvis
release. It is the working evidence document for the
[public release plan](public-release-plan.md), not a claim that the release gate
has passed.

For a step-by-step sequence to close the open gates, use the
[public release execution guide](public-release-execution-guide.md).

## Progress

| Phase | State | Evidence or next gate |
| --- | --- | --- |
| 0. Freeze boundary and baseline | Complete | Inventories, local verification, tested-host version statement, and final new-repository source/history scans are recorded |
| 1. Licensing and provenance | Complete for source-only release | Locked dependency licenses, deployed artifact identities, source/license references, and unavailable upstream build evidence are recorded in `THIRD_PARTY_NOTICES.md` and `container-image-provenance.md`; publishing Jarvis runtime images would require the separate evidence closure described there |
| 2. Public database baseline | Complete | Empty-DB baseline, public ledger semantics, PostgreSQL integration, and first-workspace/first-message Compose acceptance pass |
| 3. Legacy and dead paths | Complete | Legacy paths and the obsolete vendoring helper are removed; tested systemd and launchd startup integration is retained |
| 4. Zero-warning lint | Complete | Refactors landed; `pnpm verify` passes with zero lint warnings |
| 5. Public naming | Complete | Jarvis is the public name; release vocabulary, setup-owned state, unique worker lease identity, and Pi implementation/provider distinction are explicit |
| 6. Secure setup | Complete for first release | Guided owner and brain registration, recovery handoff, registration sealing, artifact publication, migration, and startup are implemented; the operator confirmed recovery, brain-device trust, and sealed registration on macOS and Arch |
| 7. Routine operator interface | Complete for first release | Start/stop/status/logs/update/backup/restore wrappers and focused tests are implemented; backup and restore are operator-confirmed on macOS and Arch; live update and boot rehearsals are explicitly post-release work |
| 8. Matrix activity notices | Complete | Threaded delivery, cancellation, and interrupted Orchestrator plan recovery are operator-confirmed in real clients/workspaces |
| 9. Documentation | Complete for first release | Guided installation and daily operations are documented; release-scope claims and operator command examples were reviewed against scripts, three discrepancies were corrected, and `pnpm verify` passed |
| 10. Release hardening | Complete for source-only release | macOS and Arch installation, backup/restore, and live scenarios are operator-confirmed; the final source snapshot is clean and CI passes. Live update, reboot/login, and Ubuntu 24.04 validation remain post-release work |

Baseline checkout: `61257fa7d2bc96086690a1700c24dbda7c8d1f03`
(2026-09-26).

## Supported public surface

The first-release production hosts are macOS 26.4 arm64 and Arch Linux x86-64
through Docker Compose. The operator confirms installation and checks on both.
Ubuntu 24.04 validation is a post-release task. Tested Docker versions are
listed below; older version floors are unverified.

The first release is source-only: operators build Jarvis images locally from
this repository. No prebuilt Jarvis images are planned for publication. This
does not remove the requirement to identify and document automatically
downloaded third-party artifacts, or to review bundled-component obligations
before any later image distribution.

| Component | Current repository baseline | Public-release status |
| --- | --- | --- |
| Node.js | 24 or newer, aligned with direct Matrix dependency requirements | Node 24.15.0 was verified on macOS and Arch; newer versions are not separately rehearsed |
| pnpm | 11.5.0, pinned by `packageManager` | Verified on macOS and Arch |
| Docker | Engine with BuildKit and Compose; production Compose uses `include` | Tested hosts: macOS Engine 29.6.1 / Compose 5.3.0 / Buildx `v0.35.0-desktop.2`; Arch Engine 29.8.1 / Compose 5.6.0 / Buildx 0.38.0. Older versions are unverified |
| Matrix | Bundled digest-pinned Continuwuity; Matrix Client-Server API v3 endpoints | Proposed: support the bundled artifact only for the first release |
| PostgreSQL | PostgreSQL 16.15 Alpine 3.24 production image | Multi-platform digest is the source-only starter default; concrete package versions, licenses, Alpine source commits, and platform manifests are recorded for amd64 and arm64 |
| Inference | HTTP(S) OpenAI-compatible `POST /v1/chat/completions` | Protocol compatibility only; inference implementations are operator managed |
| Optional features | Browser agent, optional voice replies, and observability overlay (Loki, Alloy, Prometheus, Grafana) | Browser/voice capabilities use source-built runtime images; observability image references are operator-selected and outside the fixed first-release image set |

Selected compatibility statement:

> Jarvis 0.1.x supports fresh installations on macOS 26.4 arm64 and Arch Linux
> x86-64 with the tested Docker/Compose/Buildx toolchains recorded above,
> Node.js 24, and pnpm 11.5.0. It supports its bundled Continuwuity artifact and
> PostgreSQL 16 deployment. It requires an operator-managed HTTP(S),
> OpenAI-compatible `POST /v1/chat/completions` endpoint. Private pre-release
> databases and unknown or pre-baseline schema ledgers are unsupported and
> require reinstalling. `/v1` routes, `*V1` contracts, `schemaVersion: 1`, and
> plugin SDK v1 are the initial public protocol contracts. Automated boot and
> live application update have not been rehearsed on these hosts.

## Reproducible baseline

Run from a clean checkout with the documented development prerequisites:

```sh
node --version
pnpm --version
docker --version
docker compose version
pnpm lint
pnpm verify
docker compose -f deploy/compose/compose.production.yml build
```

Initial local baseline host: Linux 7.2.6-arch2-1 x86_64, Node v22.22.0,
pnpm 11.5.0, Docker Engine 29.8.1, and Docker Compose 5.5.1. The same Arch
host now has Node v24.15.0; the current verification below used that version
with pnpm 11.5.0.

| Check | Baseline result |
| --- | --- |
| Initial `pnpm lint` | Passed with 0 errors and 10 warnings: 3 complexity, 1 function length, 2 parameter count, and 4 file length warnings |
| Current `pnpm lint` | Passes with 0 errors and 0 warnings after the Phase 4 refactors |
| Current checkout `pnpm verify` on macOS 26.4 arm64 (2026-10-14) | Passed under Node 24.15.0 and pnpm 11.5.0: 228 unit-test files/1,168 tests passed, one test file/four tests skipped, 109 operator script tests, contracts, licenses, and all static/generated checks. This is not a clean-clone fresh-install rehearsal |
| Private source-only candidate on macOS 26.4 arm64 (2026-10-14) | A fresh local Git repository containing 996 tracked source files passed frozen dependency installation and `pnpm verify` under Node 24.15.0/pnpm 11.5.0: 228 unit-test files/1,189 tests passed, one file/four tests skipped, plus 109 operator script tests and all remaining checks. This is not the final public snapshot. |
| Current macOS Docker toolchain (2026-10-14) | macOS 26.4 arm64; Docker Engine server 29.6.1, Compose 5.3.0, Buildx `v0.35.0-desktop.2`; these are observed local versions, not minimum-version claims |
| Latest isolated integration/system suites on macOS 26.4 arm64 (2026-10-14) | 74 PostgreSQL integration tests and 16 Compose system tests passed; two optional Compose fixtures were skipped. The delegated-worker fixture was updated from retired `planner` to `orchestrator` after the first integration run failed. |
| Initial production Compose build | Failed during interpolation before build because protected secrets, Matrix identity, model/catalog paths, image pins, and model checksums were not configured |
| Current fresh-install path | `pnpm jarvis:setup` guides protected preparation, artifact publication, Matrix owner and brain registration, owner recovery and trust decisions, registration sealing, migration, and startup. The operator completes owner recovery, device trust, and the first private room in Element; macOS and Arch installation are operator-confirmed |
| Public database baseline | Clean PostgreSQL 16 databases reach 29 application tables, zero seeded workspaces, and ledger `7` after migrations `0001`–`0007`; focused migration tests verify fresh installs, outbound presentation, notice origin, durable delegation notice claims, stored voice transcripts, retired agent references, and schedule thread destinations alongside baseline constraints |

The Compose failure records the pre-refactor baseline, not the current setup
flow or a request to commit placeholder credentials. The secure, resumable
setup stages are implemented; selected-host acceptance evidence is recorded
below and requires final consolidation.

## Operator surface inventory

The current operator workflow is spread across root package scripts, the
production runbook, Matrix bootstrap scripts, runtime-profile/catalog release
scripts, and systemd/launchd installation scripts.

Supported production configuration currently starts with the 38 variables in
`deploy/compose/production.env.example`. Production Compose additionally
accepts `INFERENCE_UPSTREAM_BASE_URL` and `MATRIX_HOST_PORT`, which are missing
from that template. Boot integration adds `INFERENCE_SERVER_COMMAND`,
`JARVIS_COMPOSE_PROJECT`, `JARVIS_COMPOSE_ENV`, `JARVIS_COMPOSE_FILE`, and
`JARVIS_RUNTIME_ENV`. Application-level tuning variables are internal until
explicitly promoted into the supported operator surface.

Release-managed host state consists of the runtime-profile directory
(`current-runtime.json` and digest-addressed resource bundles), the platform
catalog directory (`platform-catalog.v2.json`), PostgreSQL and Matrix state,
Matrix crypto, media/model caches, and optional observability state. The Docker
socket is mounted read-write only into Runtime Provisioner. Published
production ports are loopback-only: Matrix by default, plus optional Prometheus
and Grafana. Other application listeners remain on private Compose networks.

Downloaded or generated artifacts requiring provenance include the Whisper
model, Piper voice and configuration, vendored Pi profile resources,
Playwright/Chromium assets, npm dependencies, built runtime images, PostgreSQL,
Continuwuity, and optional observability images. Whisper and Piper downloads
are now immutable and checksum-verified. The Browser image's npm and Python
package inputs are locked, and its six Linux Playwright archives are
checksum-verified before installation. Remaining gaps include archive-level
license/source closure and release-selected container image contents.

## Secret and private-data review

The initial name/signature scan found no obvious credentials, private keys, or
private artifacts in the tracked tree or 433 commits reachable from the 15
local heads, tags, and remote refs. Only `.env.example` matched the suspicious
filename review and its current values are non-secret examples. A pinned,
fully redacted Gitleaks v8.30.0 history scan subsequently examined all 433
commits and reported four generic-key matches. All four were classified from
their test context as synthetic fixtures, with no credential rotation or
history rewrite indicated. A second pinned, fully redacted scan over the 435
commits currently reachable from local refs again reported the same four
redacted findings. A separate redacted scan of a temporary copy of tracked and
non-ignored current files reported four generic-key matches, all in test files
and classified as synthetic fixtures. The actual new public repository still
needs a repeat scan after its source snapshot is copied.

A later pinned Gitleaks v8.30.0 scan of a temporary 997-file snapshot of
tracked and non-ignored source files again reported four `generic-api-key`
findings in the same synthetic test fixtures. The ignored private production
environment and old `.git` history were excluded. This is useful current-source
evidence, but the actual new public repository must still be scanned after its
final files are copied.

On 2026-10-13, a private source-only snapshot initially copied 1,015 tracked and
non-ignored files, including the current uncommitted release work, without the
old `.git` directory or ignored deployment state. Pinned Gitleaks v8.30.0,
identified by image digest in CI, initially found five `generic-api-key`
matches in synthetic test fixtures. Replacing those fixture literals with
short test keys or generated signing material preserved the focused tests and
made the same redacted source scan exit successfully with **zero findings**
over 4.10 MB of source. A redacted history rescan of the private checkout
reported four previously classified test-fixture findings across 440 scanned
commits (444 commits are reachable from local refs). The first public
repository will not import that history. A filename review found no credential
files among the copied sources; the only local populated production environment
remains ignored. Current source references to `/home/`, `/Users/`, and `/root/`
are documentation, synthetic setup tests, and container cache paths, not live
host paths. A fresh Git staging check exposed four required source files that
the old `.gitignore` would omit: the ESLint configuration and three
hand-authored declaration files. The ignore exceptions and source guard now
include them; the private staging index contains 1,017 intended source files.
These checks complete the current checkout review, while the final
new-repository snapshot and its newly created history still require their own
scans.

After the Browser archive verifier and runtime-profile source move, a fresh
2026-10-13 source-only snapshot copied 990 tracked or non-ignored files from the
current worktree, excluding the old `.git` history and ignored deployment
state. The pinned, redacted Gitleaks v8.30.0 scan covered approximately 3.97 MB
and reported **zero findings**. This remains preliminary evidence: the final
public repository and its new history need a separate scan after creation.

On 2026-10-14, a new private local candidate was assembled from 996 tracked
source files without the old `.git` directory or ignored deployment state.
The pinned, redacted Gitleaks v8.30.0 scan found **zero findings** in the
copied source and **zero findings** in its one-commit new history. Frozen
dependency installation and `pnpm verify` passed after the candidate's initial
commit. This rehearsal corrected the handoff order: runtime provenance checks
need a Git revision, and catalog compilation reads tracked plugin resources.
The candidate is temporary and predates final provenance and host rehearsals;
repeat both scans on the actual release snapshot.

An ignored, untracked `deploy/compose/.env.production` exists locally and
contains populated production/private-deployment fields. It is absent from
reachable history and remains excluded by `.gitignore`; its mode was tightened
from `0644` to `0600` during this audit. It must not enter a release archive or
diagnostic bundle, and its credentials should be rotated if prior exposure is
uncertain.

Before publication, run a pinned Gitleaks release and review only its redacted
detector, path, and commit metadata:

```sh
gitleaks git --redact --no-banner --log-opts="--all" \
  --report-format json \
  --report-path /tmp/jarvis-gitleaks.json .
git log --all --pretty=format: --name-only | sort -u
git status --short --ignored -- \
  deploy/compose/.env.production .env .env.example
```

An earlier absolute-path heuristic reported six findings, but its pattern and
match list were not retained, so that count cannot be reconciled. A new
redacted scan for `/home/`, `/Users/`, and `/root/` finds seven matching commits
among 435 reachable commits. Most matches are synthetic test paths or
container-internal cache locations. One deleted historical document at commit
`b574c8edaff556945d7767701e9cfd02fd518e60`,
`docs/development/MAINTAINABILITY_REVIEW_2026-08-15.md:56`, contains a real
local home username in a repository path. No credential, hostname, or IP
appears on that line. The document is absent from the current worktree, but
the commit remains reachable from `main` and `release/v1`. The first public
repository will instead be created from a reviewed final source snapshot, not
from these branches or their history. Scan that new repository and its history
before publication; do not copy the old `.git` directory.

## Open release decisions

- macOS 26.4 arm64 and Arch Linux x86-64 are the first-release hosts based on
  the operator's installation evidence. Ubuntu 24.04 validation is post-release
  work.
- Record the tested Docker versions in release notes. An older minimum-version
  floor has not been established.

## Phase 1 progress

- [x] Add the MIT license for Copyright 2026 Clément Joye.
- [x] Mark all private workspace packages with consistent MIT and author metadata.
- [x] Generate a deterministic, path-free production dependency inventory.
- [x] Reject stale inventories and unreviewed or disallowed dependency licenses.
- [x] Add third-party notices that distinguish Jarvis's MIT license from upstream terms.
- [x] Include the complete Apache-2.0 license and upstream notice for vendored Pi resources.
- [x] Record the canonical public source URL for the vendored Pi resources.
- [x] Resolve and checksum the whisper.cpp source revision rather than a mutable tag.
- [x] Record license evidence for the Whisper model, Piper runtime and voice, Chromium, and curl-cffi.
- [x] Add and enforce the missing Piper runtime and configuration checksums.
- [x] Commit npm and hash-locked Python dependencies for the Browser image, including both supported Linux architectures.
- [x] Verify platform-specific Playwright archive integrity for the Browser
  image. The six Linux x86-64 and ARM64 Chromium, headless-shell, and FFmpeg
  archives were independently downloaded and hashed on 2026-10-13; exact URLs,
  revisions, sizes, and SHA-256 values are in
  [`playwright-archives.json`](../../plugins/browser/deploy/playwright-archives.json).
  The Browser build verifies the bytes before feeding them to Playwright's
  installer. Both isolated platform asset stages built successfully on the
  macOS ARM64 development host, with amd64 under Docker emulation; the verifier
  tests reject changed bytes and unreviewed download paths. This is build
  integrity evidence, not a complete license review or fresh-host release
  build.
- [x] Record the exact Chromium/headless-shell and FFmpeg archive URLs, sizes,
  hashes, deployed ARM64 binary hashes, available license files, and upstream
  source/license references in `THIRD_PARTY_NOTICES.md`. Chromium maps to
  source tag `147.0.7727.0`; Playwright FFmpeg build 1011 reports version
  `n7.0.1` and includes `COPYING.LGPLv2.1`. The archive inventory found no
  Chromium license file in the ARM64 archives, and no FFmpeg build attestation
  or complete static dependency list is published. These evidence limits are
  documented; the source-only release publishes neither Jarvis image.
  Playwright 1.59.1's
  [pinned registry mapping](https://raw.githubusercontent.com/microsoft/playwright/v1.59.1/packages/playwright-core/src/server/registry/index.ts)
  maps Linux ARM64 to its non-CfT Chromium archive, so deployed Chromium
  `147.0.7727.0` alongside the manifest's logical `.15` version is expected.
  The deployed
  media-worker's separate Debian FFmpeg is `7:5.1.9-0+deb12u1` and reports
  `--enable-gpl`, `--enable-libx264`, and `--enable-libx265`; its GPL-enabled
  package/source evidence is recorded in `THIRD_PARTY_NOTICES.md`.
- [x] Record both platform child manifests and PostgreSQL package metadata for
  amd64 and arm64, plus the Continuwuity image's pinned source revision and
  Apache-2.0 license target. The PostgreSQL package/source-commit comparison
  and limits are in `deployed-postgres-apk-inventory.md`; the Continuwuity
  image lacks a retained Rust dependency SBOM, full notices, and independent
  build attestation. No Jarvis image is published.
- [x] Replace the CC BY-NC-SA 4.0 `en_US-ryan-high` default with `en_US-ljspeech-high`; record immutable model/config checksums and license provenance in `THIRD_PARTY_NOTICES.md`.
- [x] Record Piper and piper-phonemize source identities and licenses, the
  eSpeak NG commit selected by the pinned recipe, ONNX Runtime notice source,
  archive hashes/member inventory, model origin/hash, and unavailable build
  attestation/model-specific provenance in `THIRD_PARTY_NOTICES.md`.
- [x] Validate frozen optional dependency installation and Matrix native crypto
  loading on macOS 26.4 arm64 in the private source-only candidate; `pnpm
  verify` passed under Node 24.15.0/pnpm 11.5.0.

CI now has a public-repository-only macOS 15 arm64 source smoke job with Node
24, pnpm 11.5.0, frozen installation, a direct load of Matrix's native crypto
binding, formatting, and setup/operator tests. The direct load passed locally
on macOS 26.4 arm64 under Node 24.15.0. macOS 15 is not a selected support
target; this CI job is a separate smoke check and has not run. Keeping it
disabled while this repository is private avoids unexpected macOS runner
charges under
[GitHub's hosted-runner policy](https://docs.github.com/en/actions/reference/runners/github-hosted-runners).
The operator confirms that installation and checks completed on the current
macOS 26.4 arm64 host. The private source-only staging checkout also completed
`pnpm install --frozen-lockfile` on macOS 26.4 arm64 under Node 24.15.0 and
pnpm 11.5.0, including its native Matrix SDK download. Arch Linux x86-64 is
the selected Linux release host; Ubuntu 24.04 validation is post-release work.

A checksum-bound inventory records the pinned x86-64 and ARM64 Piper archives,
their 406-member path sets, and the identical Tashkeel model digest. The
phonemizer's pinned CMake recipe selects eSpeak NG commit
`0f65aa301e0d6bae5e172cc74197d32a6182200f`; the previous claim that it follows
a mutable branch was incorrect and is fixed in `THIRD_PARTY_NOTICES.md`. The
same source release contains the model, but does not provide model-specific
terms or training-data provenance. No publisher build attestation is
available for its binary releases.

The [container image provenance audit](container-image-provenance.md) records
the selected immutable image references and both platform manifests. The
deployed PostgreSQL ARM64 APK table was compared with the exact pinned amd64
image: all 44 concrete package versions, license declarations, Alpine origins,
and source commits match. Continuwuity's source revision and project license
are pinned, while its statically linked Rust dependency closure and notice
bundle are absent from the deployed image evidence. These limits are explicit
in the provenance records. There is no prebuilt Jarvis image in the first
release. A separate Dockerfile-input inventory finds 23 frontend/base/stage
records; Node, Debian, Alpine, and Dockerfile frontend inputs use
multi-platform digest pins, with only the intentionally dynamic internal
Browser runtime-image default left as a mutable reference.

Read-only inspection of the active deployment on 2026-10-14 confirmed the
PostgreSQL and Continuwuity image indexes on `linux/arm64`, and recorded local
image IDs and deployed Piper component hashes. The locally built media-worker
and Browser images contain no OCI source/revision/version labels, so the
inspection cannot establish which source commit built those images. The
observations and the deployed FFmpeg/Chromium findings are recorded in
[`THIRD_PARTY_NOTICES.md`](../../THIRD_PARTY_NOTICES.md); they supplement but do
not replace final digest-addressed release-image inventories or fresh-host
rehearsals.

The Arch-host `browser-assets` Docker stage built successfully with the
committed npm/Python locks and revised Playwright Chromium/headless-shell
and FFmpeg revision assertions. The isolated 2026-10-09 build produced local
image manifest `sha256:b75843c6c7f29b209f04d807ff77775b47e1cc0c83fbc4b27ecc7cb301950f3f`.
Its installed FFmpeg executable reports `n7.0.1-playwright-build-1011` and
has SHA-256 `460d44f3416005662f528d4b92e7b94ace924e8a0288106d3803b73c56eaadc8`;
the included `COPYING.LGPLv2.1` file has SHA-256
`b634ab5640e258563c536e658cad87080553df6f34f62269a21d554844e58bfe`.
These are installed-file observations, not downloaded archive checksums or
complete source/license evidence. The build verifies the Linux x86-64 path,
not the Linux arm64/macOS release-host paths.
On 2026-10-13, the revised `browser-assets` stage built for both Linux
architectures on the macOS ARM64 development host, with amd64 under Docker
emulation. The local asset-stage image manifests were
`sha256:1bca8eee9fe1add9f018210d4ecf8d21b95885bc43f54beb4ef848ef3fd08030`
(ARM64) and
`sha256:fa8fb098bdaba0b716a057100322675201f0e375b3e7dc3891037c52a3a01e16`
(amd64). Each build downloaded and checked all three platform archives before
serving the verified bytes to Playwright's installer. These are asset-stage
builds, not full Browser runtime images or fresh-host release builds.
The production media-worker Dockerfile also built successfully on Arch x86-64 using locally cached pinned
Whisper/Piper layers; this is not a clean-checkout or second-architecture build.

## Phase 0 exit criteria

- [x] Inventory the current supported-version evidence and contradictions.
- [x] Select `0.1.0`, Node 24, and bundled pinned Continuwuity as the initial compatibility baseline.
- [x] Record the initial local check and Compose/fresh-install baseline.
- [x] Run the full repository verification natively on the Arch host under
  Node 24.15.0 and pnpm 11.5.0.
- [x] Inventory commands, configuration, paths, artifacts, images, and ports.
- [x] Complete and record the current working-tree and private Git-history
  secret review; repeat on the actual new public repository before release.
- [x] Select macOS 26.4 arm64 and Arch Linux x86-64 as the first-release hosts;
  document their observed Docker toolchains without claiming an untested
  minimum-version range. Ubuntu 24.04 validation is deferred.

## Phase 3 progress

- [x] Remove the legacy delegation-token authorization path.
- [x] Replace positional compatibility constructors with explicit option-object
  construction at every production and test call site.
- [x] Remove the one-time Pi profile vendoring helper after preserving its
  upstream revision, archive digest, license, notice, and canonical source.
- [x] Audit the remaining repository scripts. Each non-service script has an
  active package command, operator workflow, build/release consumer, imported
  test surface, or verification purpose; no other script is confirmed dead.
- [x] Evaluate `code-project`. It remains a compatibility-sensitive identifier
  across contracts, runtime manifests, routing, release artifacts, and tests;
  renaming it is deferred until a complete public-identifier migration is
  designed.
- [x] Retain boot-service installation and wrappers as supported, documented
  integration, with generated systemd and launchd registration tests.

## Phase 5 progress

- [x] Use Jarvis as the operator-facing product name in current documentation
  titles and Matrix bootstrap device output.
- [x] Document `@second-brain/*` as the retained internal npm package namespace.
- [x] Define platform catalog, runtime profile, and deployment release as
  distinct operator terms in the configuration reference.
- [x] Replace configurable `BRAIN_WORKER_ID` with `BRAIN_WORKER_ROLE` and
  generate a unique lease-owner identity for every worker process.
- [x] Rename the Pi implementation selector to `PI_RUNNER_IMPLEMENTATION` and
  distinguish it from reviewed `PI_MODEL_PROVIDER_ID` and `PI_MODEL_ID` values.
- [x] Document host catalog/profile directories, fixed container paths, and
  generated tokens as installation state rather than application settings.
- [x] Infer host catalog/profile directories and generate internal tokens through
  the protected, create-only Phase 6 setup state.

Focused evidence: worker identity, Pi runtime configuration, and reviewed
runtime-image tests pass (20 tests); configuration and brain-worker TypeScript
builds, zero-warning lint, Compose validation, and documentation links pass.
The first repository-wide typecheck attempt was blocked by concurrent Phase 8
edits that had not yet populated required Matrix outbound presentation.

## Phase 6 progress

- [x] Add `pnpm jarvis:setup --config <setup.json>` as a thin non-interactive
  entry point with strict structured configuration validation.
- [x] Select Linux and macOS state roots using platform conventions, with an
  explicit absolute-path override.
- [x] Preflight Node, Corepack, pnpm, Docker, Compose, Buildx, supported CPU
  architecture, a writable parent for the configured state root, and the
  configured loopback Matrix port. A state root that is an existing file or
  has no writable existing parent fails before setup writes state.
- [x] Validate the production Compose model during preflight using a private,
  temporary file of explicitly synthetic interpolation values, then remove it.
  This checks the Compose definition before credentials exist; it does not
  validate the eventual operator-specific environment or start services.
- [x] Generate internal secrets with `node:crypto` and publish the production
  environment create-only, atomically, and with mode `0600`.
- [x] Refuse placeholder values, implicit credential choices, broadly readable
  credential configuration, and replacement of an existing environment.
- [x] Record protected preparation-stage state so interrupted setup resumes
  without rotating generated secrets.
- [x] Add interactive setup collection with hidden credential entry and a redacted summary requiring confirmation.
- [x] Support explicitly credential-free upstreams in setup validation, gateway forwarding, and production Compose.
- [x] Add opt-in inference endpoint validation using the configured model and credential choice.
- [x] Route manual Matrix bootstrap and production Compose commands through the
  setup-state `production.env`; allow setup to prepare the protected file before
  Matrix identities exist, and use the existing login helper to persist the
  brain credentials without printing them.
- [x] Require published runtime-profile and platform-catalog artifacts before
  operator or boot-service startup; fail with an actionable setup message.
  Readiness rejects placeholder/malformed manifests, checks immutable profile
  image pins against the catalog, and recomputes the catalog content digest.
  It does not establish a cryptographic signature or recompute the profile
  source digest.
- [x] Add `pnpm jarvis:setup --publish-artifacts` for initial build-and-verify
  publication, independent of Matrix bootstrap. It uses protected setup paths,
  skips migration and service changes, and records success only after both
  artifacts are present. A failed attempt remains retryable.
- [x] Add durable, readiness-checked `matrix-bootstrap` and `artifacts`
  checkpoints plus `pnpm jarvis:setup --status`; setup never prints credentials
  in status output or recreates internal secrets while marking these checkpoints.
  Interactive setup displays the one-time first-user token read from local
  homeserver logs so the operator can review it. Matrix
  completion and operator startup also require the temporary registration token
  to be removed; artifact publication can be checkpointed independently.
- [x] Add `pnpm jarvis:setup --seal-matrix-registration` after manual account
  and E2EE bootstrap. It validates protected identity/recovery fields, clears
  the temporary token, sets registration to false through an atomic private
  file replacement, and records Matrix completion only after readiness passes.
  Operator startup rejects enabled, missing, or duplicate registration flags.
- [x] Report read-only Matrix resume checkpoints in `pnpm jarvis:setup --status`
  without printing IDs, credentials, or recovery-key values. Presence checks do
  not prove identity trust or an external recovery-key backup.
- [x] Add `pnpm jarvis:setup --store-matrix-recovery-key` with twice-confirmed
  hidden TTY entry, an owned private environment, atomic persistence, and
  refusal to replace an existing key. This confirms local storage, not key
  validity or an external recovery backup.
- [x] Rehearse the registration seal against an isolated Arch-host Continuwuity
  Compose project: register a synthetic account, seal the protected setup
  environment, verify readiness and token-free rendered configuration, restart
  the homeserver, and confirm new registration is closed. This is not the full
  production setup or E2EE trust rehearsal.
- [x] Add explicit `pnpm jarvis:setup --migrate`, gated on verified Matrix
  bootstrap and release artifacts; it reuses the forward-only migration script
  and records completion only after that command succeeds.
- [x] Add explicit `pnpm jarvis:setup --start`, gated on migration and install
  readiness; it reuses operator startup (`docker compose up --wait`) and records
  the initial configured health-check result only after startup succeeds.
- [x] Guide owner and brain account registration, brain E2EE recovery, and
  registration sealing in the interactive setup flow. Owner recovery, device
  trust, and the first private room remain operator actions in Element.
- [x] Validate owner recovery and brain-device trust in Element during the
  selected macOS and Arch installations (operator-confirmed 2026-10-15;
  client versions were not recorded).
- [x] Prove the sealed registration setting and complete setup flow on fresh
  macOS and Arch hosts, including the bootstrap-to-production restart boundary
  (operator-confirmed 2026-10-15).

## Phase 7 progress

- [x] Add setup-state-backed start, stop, status, and logs commands using the
  protected setup environment without printing its values.
- [x] Mark non-running/unhealthy services and missing artifacts as degraded in
  status, with executable recovery guidance. A reviewed runtime update can
  rebuild missing artifacts. Startup requires matching release artifacts;
  update modes can repair a mismatch, while resource-only updates verify all
  pinned runtime images before replacing the catalog or room containers.
- [x] Add application, runtime-profile, and resource-only update modes. Runtime
  and resource changes require explicit acknowledgement that active runs may be
  interrupted; application migration remains forward-only.
- [x] Back up PostgreSQL plus the platform catalog and runtime-profile files to
  a mode-0700 directory with a mode-0600 manifest and database archive.
- [x] Add a separate guided, files-only workspace backup command that selects
  a Matrix room, verifies its existing data volume, and archives it with a
  checksum manifest. This does not extend the application restore command.
- [x] Require a typed `RESTORE` confirmation (or explicit `--yes`), validate
  the backup checksum, stop the stack, and retain previous catalog/profile
  directories during restore.
- [x] Add tested systemd user-unit and launchd-agent generation/registration
  paths; document the operator-owned inference service dependency.
- [x] Parse generated launchd plists with `xmllint` when available during the
  temporary-home installer test. This does not validate macOS login behavior.
- [x] Rehearse the application updater against a uniquely named Arch-host
  Compose project and its real PostgreSQL database under Node 24.15.0. Frozen
  install, migration-level verification, image rebuild, and service health
  passed; the fixture already had the latest schema, so this does not prove a
  forward migration from an older release.
- [x] Accept the operator's successful backup and restore on macOS and Arch
  (2026-10-15) as first-release restore evidence. The isolated Arch Compose
  restore fixture also passes. Exact operator commands, restored-data checks,
  and isolation details were not supplied; those remain a post-release record.

The Arch-host isolated Compose rehearsal passes a database plus
catalog/runtime-profile backup, test-only mutation, and restore round trip. It
uses a temporary state root and a uniquely named Compose project. The operator
also reports successful backup and restore on macOS and Arch, but isolation and
restored-data evidence for those runs have not been recorded.

Focused evidence: `pnpm jarvis:operator:test` covers operator behavior,
boot-service generated files, and setup/runtime scripts. The application-update
unit tests assert migration runs before Compose rebuild/restart and that a
failed migration prevents restart. The opt-in database-backed Arch rehearsal
uses `RUN_APPLICATION_UPDATE_REHEARSAL=true` with the Compose smoke test; it
passed and removed its temporary project and volumes. Prettier and full
`pnpm verify` pass natively on the Arch host under Node 24.15.0 (1,147 unit
tests; one optional test skipped). The Arch Linux and macOS installations have
been operator-confirmed.

Run the isolated application-update scenario with Docker and Node 24:

```sh
RUN_APPLICATION_UPDATE_REHEARSAL=true pnpm --filter @second-brain/system-tests \
  exec vitest run --config vitest.config.ts compose/compose-smoke.system.ts \
  -t 'runs the application updater against this isolated Compose database'
```

## Phase 8 progress

- [x] Add the built-in `orchestrator` agent with workspace plan checkpoints,
  bounded sequential delegation, and concise recovery instructions. Its
  resources are included in the reviewed profile bundle.
- [x] Add explicit `assistant`, `notice`, and `error` outbound presentation.
- [x] Persist presentation through the existing workspace-scoped idempotent outbound path.
- [x] Render routine activity as Matrix `m.notice` with safe HTML; render errors as regular messages so they remain visible.
- [x] Preserve conversation, reply, and thread origin when rendering notices.
- [x] Exclude non-assistant outbound messages from injected Matrix thread history.
- [x] Emit immediate delegation notices from the reviewed delegation lifecycle.
- [x] Add one delayed progress notice after selecting and documenting the threshold.
- [x] Map terminal inbound failures to a concise safe message; job and trace identifiers remain in structured failure logs.
- [x] Deduplicate delayed progress and terminal failure notices across retries.
- [x] Cap immediate delegation notices at three per root run with durable,
  retry-stable claims; verify notices retain originating-thread context.
- [x] Verify end-to-end threaded notice delivery on a real Matrix client
  (operator-confirmed 2026-10-15).
- [x] Confirm the typing hint clears promptly after `/cancel` on desktop and
  mobile Element. The operator confirmed both client checks on 2026-10-15.
  The 2026-10-14 gateway fix clears accepted cancellations, skips typing for
  commands and duplicate events, and orders room typing updates; focused tests
  and an isolated Compose run also pass.
- [x] Rehearse an interrupted `@orchestrator` task in a real workspace: resume
  from `.plan/`, verify the previous child outcome, and avoid repeating an
  uncertain external action (operator-confirmed 2026-10-15).

Root and delegated agent runs persist their originating Matrix conversation and
thread context. Immediate delegation notices and terminal inbound failure
notices use the durable workspace-scoped outbound path and deterministic
idempotency keys. The first delegation schedules one root-scoped progress job
for 35 seconds later using the queue's persisted availability timestamp. The
worker sends it only if the root is still running, uses the stored origin
thread, and applies a second deterministic outbound idempotency key so retries
cannot duplicate delivery. The job payload contains only the root run ID.
At delivery time the notice names one or two active delegated agents, uses a
generic task count for larger parallel groups, and falls back to a request-level
progress message if no delegated child remains active. This keeps the notice
useful when delegation finishes before the threshold without exposing run IDs.
Immediate delegation notices reserve one of three root-scoped slots in a
PostgreSQL claim ledger under a root-row lock. The decision is keyed by root and
child run IDs, so retries retain their original decision and concurrent child
delegations cannot exceed the cap. Notice content still comes from the child
agent label and the persisted origin thread; the ledger stores no message text.

## Phase 9 progress

- [x] Add public installation and daily-operations guides, a concise README,
  and a documentation index.
- [x] Remove completed repository-cleanup records and the superseded
  synchronous-delegation plan while retaining its ADR rationale.
- [x] Keep the detailed public release plan as the source of phase requirements.
- [x] Add maintenance documentation for upgrades/schema baseline, credential
  rotation limits, model artifacts, Matrix trust/recovery, observability, and
  boot services.
- [x] Reconcile the installation guide and setup-state documentation with the
  guided `pnpm jarvis:setup` path.
- [x] Review first-release operator command names and options against the
  package scripts and public CLI, then correct the install, daily-command,
  maintenance, and execution guides. The operator reports `pnpm verify`
  passing after these changes; live update and boot behavior are post-release
  acceptance work.

## Phase 10 progress

- [x] Add root contributor, security-reporting, and support/version policies.
- [x] Add CI documentation, Compose, ignored-artifact, and redacted working-tree
  secret checks to the existing static/unit/contract/integration workflow.
- [x] Run setup, operator, boot-service, and runtime-update script tests in
  both `pnpm verify` and CI so release workflow regressions fail the routine
  checks, not only focused manual runs.
- [x] Run the new archive, image-inventory, Dockerfile-input, container-image,
  and voice provenance unit checks in both `pnpm verify` and CI.
- [x] Run a pinned, redacted history scan (435 commits currently reachable)
  and classify its four test-fixture findings without exposing values.
- [x] Remove the synthetic test literals that triggered the CI source secret
  scan; the pinned Gitleaks v8.30.0 scan of the source-only snapshot now exits
  with zero findings. The private history still has four
  classified fixture findings and will not be imported into the public repo.
- [x] Verify a private, source-only staging checkout with a fresh Git index:
  all 1,017 intended files are staged, frozen dependency installation succeeds,
  and `pnpm verify` passes under Node 24.15.0. This found and fixed missing
  ignore exceptions for `eslint.config.js` and three hand-authored declarations.
  The staging checkout is not the final public repository or release commit.
- [x] Run `pnpm verify`, the isolated PostgreSQL integration suite, and the
  isolated Compose system suite on the current macOS 26.4 arm64 host under Node
  24.15.0: 1,164 unit tests, 70 PostgreSQL integration tests, and 16 Compose
  tests pass; two opt-in Compose fixtures remain skipped. This is not the
  selected macOS 26.4 fresh-install rehearsal.
- [x] Re-run `pnpm verify` on the current macOS host under Node 24.15.0 after
  the Browser archive verifier and runtime-profile source move; the full gate
  passes, including formatting, documentation links, license inventory,
  architecture checks, contracts, and schema checks.
- [x] Operator reports `pnpm verify` passed on 2026-10-15 after the first
  release-documentation pass and again after the maintenance and execution-guide
  corrections. The eventual new public repository must be checked separately.
- [x] Re-run the full PostgreSQL integration and isolated Compose system suites
  on the Arch host under Node 24.15.0: 69 PostgreSQL tests and 16 Compose tests
  pass, with two opt-in Compose fixtures skipped in the full run. The isolated
  application-update fixture also passes when run explicitly.
- [x] Publish a clearly illustrative, private-data-free Matrix conversation
  showing delegation and delayed progress notices; it is not a substitute for
  a captured real-client rehearsal.
- [x] Prepare [0.1.0 release notes](../getting-started/release-notes-0.1.0.md)
  with tested host toolchains, fresh-install compatibility, backup scope, and
  explicitly deferred update and boot validation. Review them again against
  the final public source snapshot before publication.
- [x] Operator reports `pnpm docs:check-links` passed after the 0.1.0 release
  note was added and linked (2026-10-15).
- [x] Decide the historical username-path handling: publish a new repository
  containing only the reviewed final source snapshot, without the old `.git`
  history. No rewrite of the existing repository is needed. The earlier
  six-path heuristic cannot be reproduced.
- [x] Scan the actual new repository snapshot and its complete history before
  publication (2026-10-19): pinned Gitleaks v8.30.0 image
  `sha256:691af3c7c5a48b16f187ce3446d5f194838f91238f27270ed36eef6359a574d9`
  reported no leaks in the source tree (~15.0 MB) or the four reachable
  commits (~4.32 MB).
- [x] Operator-confirmed fresh install and checks on the current macOS 26.4
  arm64 host (2026-10-14). Backup and restore were subsequently reported on
  macOS; update, boot service behavior, and checks added after the install
  remain separate.
- [x] Operator-confirmed guided setup and backup creation on Arch Linux
  (2026-10-15) at `b0d1a3527a101dcc58dae5e13a2e1f4d18e8c80f`, with Node
  24.15.0, pnpm 11.5.0, Docker Engine 29.8.1, Compose 5.6.0, and Buildx
  0.38.0. Setup checkpoints completed; `pnpm verify`, PostgreSQL integration,
  and Compose system tests passed on Arch and, per the operator, on macOS.
  The exact backup command and redacted result are not yet recorded.
- [x] Confirm the Arch `brain-delegation-worker` runs after the runtime-profile
  mount fix in `73c0b9c`; the operator pulled it, ran `pnpm jarvis:start`, and
  reported the worker running. Boot service behavior and the other end-to-end
  scenarios remain separate checks.
- [x] Operator-confirmed live Arch scenarios on 2026-10-15: a first encrypted
  reply, media handling, a due schedule, Browser approval, delegation, and a
  reply after stopping and starting Jarvis all passed.
- [x] Operator-confirmed on macOS and Arch: first encrypted reply, media,
  due schedule, Browser approval, delegation, and a reply after stop/start.
  The Arch report is recorded above; the matching macOS report was confirmed
  on 2026-10-15. Live application update and boot behavior are post-release
  acceptance work.

### Post-release validation backlog

- [ ] Rehearse a fresh installation and the release scenarios on Ubuntu 24.04
  before adding Ubuntu to the supported-host statement.
- [ ] Rehearse a live application update from an earlier public version on an
  isolated deployment, including a forward migration and data preservation.
- [ ] Validate systemd startup after an Arch reboot and launchd startup after
  macOS logout/login, including custom state roots and inference dependencies.
- [ ] Capture exact commands and restored-data checks for the operator-reported
  macOS and Arch restores, and repeat on isolated hosts if full recovery is to
  be claimed beyond the first-release acceptance recorded above.

### Current-deployment feature smoke checks

The operator confirmed these flows on the current Matrix deployment on
2026-10-13 and 2026-10-14:

- [x] Voice messages work after the media response, voice-preference scope, and
  stored-transcript fixes. A later turn in the same thread can use the voice
  transcript as context.
- [x] Schedule interaction works in the live chat, including the owner approval
  flow previously exercised.
- [x] An unmentioned scheduling request routes through Router, and a scheduled
  response arrives in the originating Matrix thread (confirmed 2026-10-14).
- [x] A leading agent mention switches the agent used for that conversation
  (confirmed 2026-10-14).
- [x] Document analysis works for a document sent in chat.
- [x] Browser works in an enabled room for web fetch and Playwright-based
  browsing (confirmed 2026-10-14).
- [x] An approved Browser click/type action worked in a real Matrix room, and
  the same approval could not replay it (operator-confirmed 2026-10-15).
- [x] Orchestrator delegates to other agents successfully in the current room
  after the isolated-runtime concurrency fix (confirmed 2026-10-14).
- [x] `/cancel` stops a pending response in the current Matrix thread without
  the later assistant reply (operator-confirmed 2026-10-14). The deployed fix
  covers both queued jobs and active Pi runs; fresh-host acceptance remains
  part of the phase 10 rehearsal.

These reports confirm the current deployment's user-facing behavior. Host and
tool versions, a pinned release commit, and the complete scenario evidence
for both selected release hosts are still needed before closing the combined
phase 10 rehearsal gate above. In particular, retain distinct evidence for a
due schedule's proactive delivery, playable generated audio, approved Browser
click/type behavior, interrupted Orchestrator recovery, and any document formats
claimed as supported.

The isolated Arch-host Matrix bootstrap/seal Compose test passes with a unique
project and volume. It does not use the real production environment or replace
the macOS and Arch fresh-install records.

On 2026-10-10, the operator reported a successful macOS deployment after the
setup and bootstrap fixes in commit `e3dd6c8`. The host version, architecture,
tool versions, clean-checkout status, launchd login behavior, and end-to-end
scenario results have not yet been recorded, so this does not close the macOS
fresh-install gate. Their macOS run passed 17/17 release-check scripts but
reported four failures among 61 setup/operator/boot-service tests and one
failure among 69 PostgreSQL integration tests. The repository now isolates the
boot-service test state root, models terminal `pause()` in the hidden-input
test doubles, and waits for asynchronous delegated-job enqueue before claiming
it. The affected script tests and the full 69-test PostgreSQL integration
suite pass on the Arch host; a macOS rerun is still required.

On 2026-10-12, the operator reported that a fresh deployment answered user
messages after the guided setup changes. This confirms the basic first-message
path on that deployment, but the host and tool versions, clean-checkout status,
recovery and trust evidence, and the other release scenarios have not been
recorded. It does not close the fresh-host acceptance gates.

A read-only Arch-host precheck found the Dockerfile bases pinned. The
unprivileged process could not access the Docker socket, but approved,
isolated builds passed for all 13 locally built production Compose services
under the new `jarvis-build-audit-20261006-1` project tags. A separate
`deploy/images/pi-jarvis.Dockerfile` build passed under
`jarvis/pi-jarvis:release-audit-20261006-1`, followed by its no-network
base-runtime profile probe. No service or volume was started. These builds
used a dirty, untagged Arch worktree and synthetic Compose values; they do
not satisfy the clean-source build or selected-host release rehearsal gates.

A focused Arch-host Compose schedule test now creates a persisted one-time
schedule, claims its due occurrence through brain-control, and verifies the
queued execution history and pending worker job. This fixture has no
brain-worker, so Pi execution and proactive Matrix delivery remain unproved.
The Browser approval fixture test checks pending, approve/execute-once, and
reject/no-execute paths; Matrix sender authorization has separate gateway tests,
but the complete Matrix-to-Browser flow is still unrehearsed.

Arch-host smoke evidence under Node 24.15.0 (part of the selected Linux host
record): the full PostgreSQL integration suite passes 11
files and 69 tests after fixing the `0002`→`0003` schema-ledger chain and adding
the `0004` notice-claim migration. The full isolated Compose suite passes 16
tests with one optional real-media fixture skipped. This includes schedule
queueing, registration sealing, real Matrix text, file,
outbound delivery, restart, outage retry, E2EE, workspace isolation, and
plugin lifecycle scenarios. Privacy-safe gateway diagnostics identified and
helped fix a legacy media download route disabled by the bundled homeserver;
the gateway now uses the authenticated Matrix media endpoint. The test harness
removes its uniquely named Compose stack and volumes after the run.
