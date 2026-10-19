# Container image release provenance

The production Compose stack uses one fixed Continuwuity image and defaults
PostgreSQL to the reviewed multi-platform index
`docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`.
Operators can override it through the protected environment file. The optional
observability stack uses four operator-selected images; those references must
come from the exact protected environment file used for the release.

Locally built images also consume upstream Dockerfile inputs. The production
Dockerfiles and plugin runtime Dockerfiles use base images and a Dockerfile
frontend; those inputs do not appear in the Compose external-image audit.

## Resolve selected image references

Run the audit against the release environment file (do not copy that file into
the repository):

```sh
node scripts/checks/audit-container-image-provenance.mjs /absolute/path/to/.env.production
```

The script asks Docker Compose to resolve the production configuration and,
when all four observability variables are present, the observability overlay
too. It emits JSON containing only resolved image references and their
SHA-256 digest strings. It rejects references that do not end in a 64-character
immutable digest. To retain a release record, redirect this output to the
release evidence directory outside the repository. The check does not pull
images, inspect registry manifests, identify upstream sources, or determine
licenses.

## Inventory Dockerfile base inputs

Run the local, network-free inventory with:

```sh
node scripts/checks/audit-dockerfile-base-images.mjs
```

It scans `deploy/images/` and `plugins/` for Dockerfiles, and emits each
Dockerfile frontend plus each external `FROM` image. Internal stage aliases are
identified separately. A direct reference or an `ARG` default without a digest
is labeled `mutable-reference`; an `ARG` used by `FROM` is reported at its
Dockerfile default and explicitly warns that a build argument may override that
value. An `ARG` without a default is unresolved. The inventory is a source
review aid: it does not know build-time overrides not recorded in the
Dockerfile, fetch registry manifests, or establish source/license provenance.

The external Node, Debian, Alpine, and Dockerfile frontend references are
digest-pinned to multi-platform manifest indexes while retaining readable tags:

| Input | Digest |
| --- | --- |
| `node:24-bookworm-slim` | `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6` |
| `debian:bookworm-slim` | `sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251` |
| `alpine:3.20` | `sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc` |
| `docker/dockerfile:1.7` | `sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e` |

These digests were selected as the multi-platform build inputs and are enforced
in the production Dockerfiles and Browser build. The Browser Dockerfile's
`BASE_RUNTIME_IMAGE` remains an intentional build-time input with the local
default `jarvis/pi-jarvis:current`; its resolved image must be captured
separately for each release build. For the pinned indexes, complete provenance
still requires recording source/license evidence and platform-specific child
manifest digests for supported build hosts. The audit inventory will flag any
future unpinned base or frontend reference.

## Evidence required before Jarvis distributes a runtime image

The first Jarvis release is source-only and does not distribute these runtime
images. The deployed external-image identities and available source/license
references are recorded below. If a later release publishes a Jarvis runtime
image, review and retain all of the following alongside its audit JSON:

- upstream project and canonical source/release URL;
- exact version or source revision represented by the selected digest;
- license identifier and the upstream license and notice files;
- image index digest and the platform-specific manifest digest(s) used by
  supported hosts;
- a package inventory from the exact platform image, including OS packages,
  bundled executables, and their license/notice closure; and
- the inventory tool, version, command, date, and the digest it inspected.

The OCI image's `org.opencontainers.image.source`, `version`, `revision`, and
`licenses` labels are useful leads, but labels are publisher assertions and do
not replace review of the source release or files in the image. The deployed
Continuwuity image supplies a source revision label; this narrows the source
review to that commit, but is not an independent build attestation. Likewise, a
tag's current contents are not evidence for a digest-pinned image. Compare the
selected digest with the registry's immutable manifest and retain the resulting
platform manifest identities. Inspect each supported platform separately;
multi-platform index digests can resolve to different filesystem contents.

Do not treat PostgreSQL's upstream project license as evidence for every
package in its Alpine-based image. Do not treat the Continuwuity repository
license as evidence for all files included in its image. Record the image
contents and notices before redistributing a Jarvis image. Keep operator
credentials and the protected environment file out of the evidence artifact.

## Generate a platform package inventory

Install a reviewed version of [Syft](https://github.com/anchore/syft) and
Docker Buildx, then run the inventory separately for each supported platform
and each exact digest-pinned image. The command reads the registry index with
`docker buildx imagetools inspect --raw`, verifies that its bytes match the
requested digest, resolves the unique child manifest for the platform, then
asks Syft to inventory that platform. It does not start a container:

```sh
node scripts/checks/inventory-container-image-platform.mjs \
  'docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea' \
  linux/amd64 /outside/release-evidence/postgres-linux-amd64.json
node scripts/checks/inventory-container-image-platform.mjs \
  'docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea' \
  linux/arm64 /outside/release-evidence/postgres-linux-arm64.json
node scripts/checks/inventory-container-image-platform.mjs \
  'forgejo.ellis.link/continuwuation/continuwuity@sha256:5cc03961412fb74836a14599cda3bfa17f003df902d9555281fa973976c5243b' \
  linux/amd64 /outside/release-evidence/continuwuity-linux-amd64.json
```

Repeat for `linux/arm64` where that image publishes the platform. The report
records the immutable index reference, verified index digest, selected child
manifest digest and platform descriptor, UTC capture time, Syft version, and
Syft package/license findings. Keep reports outside the repository and
preserve them without editing. Review package metadata,
bundled files and upstream license/notice texts manually before concluding
license coverage. The generated inventory can omit statically linked or
unrecognized components and does not establish complete transitive license
or notice closure. The script will not overwrite an existing output file.

### Exploratory Arch-host inventory (2026-10-05)

The selected immutable indexes resolved to these Linux child manifests:

| Image | amd64 | arm64 |
| --- | --- | --- |
| PostgreSQL 16.15 Alpine 3.24 | `sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551` | `sha256:2c942175a1255a9abe0366e48c1b401d9f50f835b04dfea13f111609b5530df7` |
| Continuwuity | `sha256:840eda84b5635dd1912792dea5f66844f7bfb154c787780122cf4a1a92c1296c` | `sha256:a0248a13139f89f6329b40fce84c31d0d6128e254ad6a8b8c258172a81891b68` |

An ephemeral Syft 1.54.0 binary, whose Linux amd64 archive matched the SHA-256
published with its versioned upstream release, scanned each platform from the
index references. PostgreSQL yielded 50 artifacts on each platform (APK,
binary, and Go-module entries); five amd64 entries had no license metadata.
Continuwuity yielded only one Debian-package entry and no license metadata on
each platform. These scanner results are leads, not a complete inventory of
image files or bundled software. The temporary SBOMs were not added to the
repository; regenerate and retain them in the final release evidence store,
then review actual image contents and notices before closing this gate.

### Primary-source leads reviewed (2026-10-09)

For the selected PostgreSQL image, Docker's Official Images metadata maps
`16.15-alpine3.24` to the `docker-library/postgres` source at commit
`9d15534160ade17f2b6c455a39ee967c49b1937d`. Its pinned
[Alpine Dockerfile at that commit](https://github.com/docker-library/postgres/blob/9d15534160ade17f2b6c455a39ee967c49b1937d/16/alpine3.24/Dockerfile)
builds PostgreSQL 16.15 from the upstream source archive and checks the archive
against SHA-256
`c1575341fa7bd40f5274ea465b34390f4dc64cdd0770af327005caaeb9f6b7ed`. The
[official-images metadata](https://github.com/docker-library/official-images/blob/master/library/postgres)
and [Docker image documentation](https://github.com/docker-library/docs/blob/master/postgres/README.md)
identify the packaging source and tag mapping. PostgreSQL describes its own
terms and reproduces the license text on its [license page](https://www.postgresql.org/about/licence/).
This establishes useful upstream leads for PostgreSQL and the image recipe,
but not the source revision or license closure of every package, executable,
or notice in the selected platform images.

For Continuwuity, the running image's OCI labels identify source revision
`a237672c90ceafbf46fc2ce9779b7a50ebb3c142`, version `v26.9.0`, and the
canonical Forgejo repository. The source link is pinned to that revision:
[repository tree](https://forgejo.ellis.link/continuwuation/continuwuity/src/commit/a237672c90ceafbf46fc2ce9779b7a50ebb3c142),
[Cargo metadata](https://forgejo.ellis.link/continuwuation/continuwuity/src/commit/a237672c90ceafbf46fc2ce9779b7a50ebb3c142/Cargo.toml),
and [LICENSE](https://forgejo.ellis.link/continuwuation/continuwuity/src/commit/a237672c90ceafbf46fc2ce9779b7a50ebb3c142/LICENSE).
The project metadata declares Apache-2.0. The image's revision label is
publisher-provided and is not an independent build attestation. The previous
Syft scans found only a Debian package and no license metadata, so those scans
do not establish the statically linked Rust dependency closure or retained
notice bundle. This is the limit of the deployed image evidence.

The deployed PostgreSQL ARM64 APK package metadata is recorded in
[`deployed-postgres-apk-inventory.md`](deployed-postgres-apk-inventory.md).
It identifies installed package versions, declared licenses, Alpine package
commits, and project URLs for that platform. Each package commit links to its
Alpine packaging/source revision; the record does not archive every upstream
source tarball or license text. The independently generated Syft inventories
resolve both PostgreSQL and Continuwuity image child digests for amd64 and
arm64, but are exploratory findings, not complete component or notice
inventories. Continuwuity's pinned image label plus upstream revision link
identify a reviewable source target; neither proves the publisher built the
image from that source.

The inventory command passes Syft the already resolved platform child manifest
digest directly, and stores that exact reference in `scannedImage` in addition
to the parent index and child descriptor. This makes the scanner input
explicit in the retained report. It still relies on Syft's package detection
and does not verify image source attribution or establish complete license
coverage.

## Current known fixed reference

`deploy/compose/compose.base.yml` pins Continuwuity to:

```text
forgejo.ellis.link/continuwuation/continuwuity@sha256:5cc03961412fb74836a14599cda3bfa17f003df902d9555281fa973976c5243b
```

Its source revision and project license are recorded above. The deployed image
does not retain a complete SBOM, Cargo dependency lock/source bundle, or
independent build attestation, so exact binary-to-source correspondence and
transitive notices cannot be established from this deployment. PostgreSQL's
ARM64 package metadata and both platform manifest identities are recorded; the
amd64 package list and a retained per-package source/notice bundle are absent.
The source-only release does not distribute either upstream image as a Jarvis
image. Optional observability images remain operator-selected and outside the
release baseline; they have no fixed digest to inventory.
