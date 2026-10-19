# Third-party notices and provenance

Jarvis is licensed under MIT, but that license does not replace or relicense
the software, models, voices, browser binaries, operating-system packages, or
container images listed here. Operators and redistributors must comply with
the corresponding upstream terms.

This is a source/build provenance inventory. An entry marked **incomplete**
means exact artifact evidence remains missing; it is not an assertion that the
artifact has no license or a legal conclusion about source publication. The
first Jarvis release is source-only and publishes no Jarvis runtime images.
Incomplete entries therefore mark limits on the recorded build provenance and
on any later image redistribution.

### Deployed host inspection (2026-10-14)

Read-only inspection of the running deployment on the macOS ARM64 Docker host
confirmed the following exact image identities and runtime contents. This is
evidence about that deployment only; the locally built Jarvis images have no
OCI source/revision/version labels, so their build inputs cannot be tied to a
source commit from image metadata. These observations do not close the
corresponding-source or complete notice review.

| Running component   | Deployed identity and observations                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Review status                                                                                                                                                                                                                                                                                                                                                                  |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| PostgreSQL          | Image index `docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`, with child manifests recorded for amd64 and arm64. The running ARM64 root filesystem and pinned amd64 image report Alpine `3.24.2`; their 44 concrete APK packages match in version, declared license, origin package, and Alpine package commit.                                                                                                                                                                                                                              | The captured [deployed APK metadata inventory](docs/development/deployed-postgres-apk-inventory.md) identifies GPL, LGPL, MIT, Apache, BSD, ICU, and other-licensed components for both platforms. Package source commits are identified, but exact source archives and a retained package notice bundle are not included.                                                     |
| Continuwuity        | `linux/arm64`, image index `forgejo.ellis.link/continuwuation/continuwuity@sha256:5cc03961412fb74836a14599cda3bfa17f003df902d9555281fa973976c5243b`. Running image labels identify source `https://forgejo.ellis.link/continuwuation/continuwuity`, [revision `a237672c90ceafbf46fc2ce9779b7a50ebb3c142`](https://forgejo.ellis.link/continuwuation/continuwuity/src/commit/a237672c90ceafbf46fc2ce9779b7a50ebb3c142), version `v26.9.0`, and creation time `2026-09-16T19:40:59.351Z`.                                                                                                                           | Source revision and project Apache-2.0 license are identified. The OCI labels are publisher metadata, not an independent build attestation; the image's Rust dependency closure and notice bundle were not retained with the deployment.                                                                                                                                       |
| Media worker        | Locally built image `sha256:60572260c607b01a1d6c85118d44849d7a1371df460128d97ef366c8b64709a9`, `linux/arm64`. Deployed Piper files include eSpeak NG, `libespeak-ng.so.1.52.0.1`, `libpiper_phonemize.so.1.2.0`, ONNX Runtime `1.14.1`, and `libtashkeel_model.ort`.                                                                                                                                                                                                                                                                                                                                              | Confirms component presence. The pinned phonemizer source recipe identifies eSpeak NG commit `0f65aa301e0d6bae5e172cc74197d32a6182200f`; the Piper binary release has no build attestation or corresponding-source bundle. Tashkeel is sourced from the same pinned repository, which has a project-level MIT license but no model-specific terms or training-data provenance. |
| Media-worker FFmpeg | Debian package `ffmpeg` version `7:5.1.9-0+deb12u1`; executable SHA-256 `249e6abb898538aeae5165a6cee0748b73f4791afb02e088d19bc5321dfe2a4e`; `/usr/share/doc/ffmpeg/copyright` SHA-256 `7447a836ec8522b699ba022d5de6c9ab39cd1682054facf550ce84589f161e2a`. Debian publishes the matching [Bookworm source package](https://packages.debian.org/bookworm/source/ffmpeg) and `.dsc` for this version.                                                                                                                                                                                                                | The deployed build reports `--enable-gpl`, `--enable-libx264`, and `--enable-libx265`; the Debian copyright file includes GPL-covered components. Treat this as GPL-enabled and retain the matching Debian source package/build configuration and notices for the media-worker image. This is distinct from Playwright's restricted FFmpeg build.                              |
| Browser runtime     | Locally built image `sha256:0d8e27909fd8dc6cc3b5ea7587362e0e7c9f2d694cc3b29e4574a5b4193718df`, `linux/arm64`. The installed Playwright package metadata declares Chromium revision `1217` / `147.0.7727.15`; the installed ARM64 binary SHA-256 `6b25a228f91c7a08c5404568816edc9365dd09cfd35b8620dca12e77a82fbb4b` reports `147.0.7727.0`. Playwright 1.59.1's pinned registry maps Linux ARM64 to its non-CfT Chromium archive, while `.15` is the logical manifest version; this version difference is expected. The image has 253 installed Debian package records and 246 `/usr/share/doc/*/copyright` files. | The version difference is explained by Playwright's architecture-specific archive mapping. Chromium notices/source and exact package-to-notice mapping remain open; the deployed runtime did not retain the archive manifest.                                                                                                                                                  |

The deployed Piper component hashes, recorded during the inspection, are:

```text
piper                              0c44a6360a21367b5d03b8656c3e274f4de715f6533245d8c1f17c242631912b
piper_phonemize                    87d1679f011b05a0195ef42a9401ec12e59c216ee91c4e5b6440498da4daa9ba
eSpeak NG executable               84c5eeaf874cd30e74b0dce2daa0406afd66dad6298967526abdff433e2f176d
libespeak-ng.so.1.52.0.1           a5d3d909de6693adad49cc6067f56bbfbfdf5c937cda0761f15f5123cc136714
libpiper_phonemize.so.1.2.0         d340669af0bca5799a48c1937725278c255799a88555b286111e65496726b5e4
libonnxruntime.so.1.14.1            8eec3ec997f04114baf667c22f192fbaaadc98cca3ece598d5042b8c2c57a44c
libtashkeel_model.ort               9f27090af3e0f661913af048a739632a3f577b3233512551d8c90580ccad4aa8
```

These hashes identify the deployed files, but do not identify the exact
eSpeak NG source revision used to produce them. The current Piper release
Dockerfile verifies the ARM64 release archive against its pinned SHA-256 during
build; the deployed image does not retain that archive or a build attestation.

## Vendored core extension resources

The core agent's `extra-tools` and shared public URL helper under
`plugins/core-agents/resources/extensions/` were derived from the local
`pi-local-profile` source checkout at revision
`262054d8dfb3d7008924f1a66967ce8a9c7dab03`. The SHA-256 of the source tree's
Git archive is
`2ec558a7e592e480b7b224b77cccfc1b9e8024c69e0b60427b8486e997000935`.
Both values were verified before import and remain the immutable evidence for
the reviewed resources.

The upstream work is licensed under Apache License 2.0 and carries this notice:

> little-coder  
> Copyright 2026 Itay Inbar
>
> This product is a derivative work based on CheetahClaws / ClawSpring
> (<https://github.com/SafeRL-Lab/clawspring>), Copyright SafeRL-Lab, licensed
> under the Apache License, Version 2.0.

The complete upstream Apache-2.0 license and NOTICE material are included in
[`third_party/pi-local-profile/`](third_party/pi-local-profile/). The checked
provenance record preserves the verified revision and archive digest.

Canonical public source: <https://github.com/clement-joye/pi-local-profile>.

## Build-time and downloaded artifacts

| Component                         | Source and immutable identity                                                                                                                                                                                                                                                                                  | Integrity                                                                                                                                                                                                                                                                                                          | License evidence                                                                                                                                                                                                                                                                                                       | Distribution                                                                                                           |
| --------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| whisper.cpp                       | <https://github.com/ggml-org/whisper.cpp/tree/23ee03506a91ac3d3f0071b40e66a430eebdfa1d>, tag `v1.8.6`                                                                                                                                                                                                          | Source archive SHA-256 `c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032`; verified during the image build                                                                                                                                                                                         | MIT                                                                                                                                                                                                                                                                                                                    | Built into the media-worker image                                                                                      |
| Whisper `ggml-small` model        | <https://huggingface.co/ggerganov/whisper.cpp/blob/5359861c739e955e79d9a303bcbc70fb988958b1/ggml-small.bin>                                                                                                                                                                                                    | SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`; verified before installation                                                                                                                                                                                                           | MIT                                                                                                                                                                                                                                                                                                                    | Downloaded automatically into a model volume                                                                           |
| Piper runtime                     | <https://github.com/rhasspy/piper/tree/38917ffd8c0e219c6581d73e07b30ef1d572fce1>, release `2023.11.14-2`                                                                                                                                                                                                       | SHA-256: x86-64 `a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992`; ARM64 `fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb`; verified during the image build                                                                                                                      | Piper source is MIT (Copyright 2022 Michael Hansen). Bundled piper-phonemize is MIT; its pinned build recipe uses eSpeak NG commit `0f65aa301e0d6bae5e172cc74197d32a6182200f` (GPL-3.0). ONNX Runtime 1.14.1 is MIT; third-party notices are linked above. The binary release has no build attestation or notice files | Included in locally built media-worker images; no prebuilt Jarvis image is published for the source-only first release |
| Piper `en_US-ljspeech-high` voice | <https://huggingface.co/rhasspy/piper-voices/tree/bae641dcb5a608cff81ccaf7ff018baaca1a33e1/en/en_US/ljspeech/high>                                                                                                                                                                                             | ONNX SHA-256 `5d4f08ba6a2a48c44592eed3ce56bf85e9de3dd4e20df90541ae68a8310c029a`; config SHA-256 `7e1f4634af596d83cca997fb7a931ba80b70f8a316a2655ee69c55365e0ace14`; both enforced before installation                                                                                                              | MIT (piper-voices repository); trained from scratch on public-domain LJ Speech                                                                                                                                                                                                                                         | Downloaded automatically into a model volume                                                                           |
| Playwright                        | npm package `playwright@1.59.1`, source commit `d466ac5358cae058cdc75d2ae3ab3ad220042730`                                                                                                                                                                                                                      | Committed npm lockfile records integrity for Playwright and its runtime dependency closure                                                                                                                                                                                                                         | Apache-2.0                                                                                                                                                                                                                                                                                                             | Installed into the Browser runtime image                                                                               |
| Chromium for Playwright           | Chromium `147.0.7727.15`, Playwright browser revision `1217`                                                                                                                                                                                                                                                   | Linux x86-64 and ARM64 Chromium and headless-shell archives have reviewed SHA-256 and size pins in `plugins/browser/deploy/playwright-archives.json`; the Browser build verifies their bytes before installation                                                                                                   | BSD-3-Clause and other Chromium component licenses; archive-level notice closure remains under review                                                                                                                                                                                                                  | Downloaded into the Browser runtime image                                                                              |
| FFmpeg for Playwright             | [Playwright 1.59.1 browser manifest](https://github.com/microsoft/playwright/blob/v1.59.1/packages/playwright-core/browsers.json) pins FFmpeg revision `1011`; deployed ARM64 binary reports `n7.0.1-playwright-build-1011` and has SHA-256 `b662355fff37fa4a0c2a353b26b3255f16a5e7fd358d97231e5a5eedd511158c` | Linux x86-64 and ARM64 archives have size/SHA-256 pins in `plugins/browser/deploy/playwright-archives.json`; the Browser build verifies their bytes. Deployed ARM64 build config disables autodetection/everything, enables only the required formats/codecs, and has no `--enable-gpl` or `--enable-nonfree` flag | Both inspected archives contain `COPYING.LGPLv2.1`; the deployed binary's exact source revision, statically linked dependency license/notice closure, and full corresponding-source materials remain unverified                                                                                                        | Downloaded into the Browser runtime image                                                                              |
| curl-cffi                         | Python package `curl-cffi==0.15.0`                                                                                                                                                                                                                                                                             | Committed hash lock covers curl-cffi and its transitive runtime dependencies for CPython 3.11 on Linux x86-64 and ARM64                                                                                                                                                                                            | MIT for curl-cffi; transitive dependency licenses are listed below                                                                                                                                                                                                                                                     | Installed into the Browser runtime image                                                                               |
| `@sinclair/typebox`               | npm package `@sinclair/typebox@0.34.49`                                                                                                                                                                                                                                                                        | npm lock integrity is recorded by the resolved build input                                                                                                                                                                                                                                                         | MIT                                                                                                                                                                                                                                                                                                                    | Installed into Pi and Browser runtime images                                                                           |

The selected voice model card identifies `en_US-ljspeech-high` as a high
quality US English model at 22,050 Hz, trained from scratch on LJ Speech. The
[LJ Speech dataset](https://keithito.com/LJ-Speech-Dataset/) states that its
recordings by Linda Johnson, made for LibriVox, along with text and annotations
are in the public domain with no restrictions on use. The immutable
[Piper voice model card](https://huggingface.co/rhasspy/piper-voices/blob/bae641dcb5a608cff81ccaf7ff018baaca1a33e1/en/en_US/ljspeech/high/MODEL_CARD)
and the [piper-voices repository metadata](https://huggingface.co/rhasspy/piper-voices/blob/bae641dcb5a608cff81ccaf7ff018baaca1a33e1/README.md)
record the model source and MIT repository license.

### Piper binary source and bundled components

`deploy/images/media-worker.Dockerfile` downloads the pinned Piper release
archive and copies its extracted `/opt/piper` directory into the final
media-worker image. This includes the Piper executable and the upstream
archive's bundled libraries and eSpeak NG data. The first public release is
source and build instructions only; it does not publish a prebuilt Jarvis
image. Operators who build the image locally obtain these runtime binaries
from the upstream Piper release. Piper's pinned source tree includes its MIT
license.

The release inputs are available at the pinned [Piper source
revision](https://github.com/rhasspy/piper/tree/38917ffd8c0e219c6581d73e07b30ef1d572fce1),
the [Piper 2023.11.14-2 binary release](https://github.com/rhasspy/piper/releases/tag/2023.11.14-2),
the [piper-phonemize 2023.11.14-4 source](https://github.com/rhasspy/piper-phonemize/tree/2023.11.14-4),
and [eSpeak NG at the source revision under review](https://github.com/espeak-ng/espeak-ng/tree/0f65aa301e0d6bae5e172cc74197d32a6182200f), including its
[GPL-3.0 COPYING file](https://github.com/espeak-ng/espeak-ng/blob/0f65aa301e0d6bae5e172cc74197d32a6182200f/COPYING).
Both pinned archives were downloaded and SHA-256 verified, then inventoried
with `scripts/checks/inventory-piper-archives.mjs`. Each contains 406 member
paths, and the sorted path sets match across x86-64 and ARM64. The inventory
includes `piper`, `piper_phonemize`, `espeak-ng`, the full
`espeak-ng-data/` language and voice tree, `libespeak-ng.so.1.52.0.1`,
`libpiper_phonemize.so.1.2.0`, `libonnxruntime.so.1.14.1`, and
`libtashkeel_model.ort` (plus shared-library symlinks and pkgconfig/data
directories). Neither archive contains a license, copying, notice, or
copyright file. The checked-in inventory tool asserts these versioned members,
the absence of such notice files, and identical path sets for both
architectures. It also extracts and verifies
`libtashkeel_model.ort` at SHA-256
`9f27090af3e0f661913af048a739632a3f577b3233512551d8c90580ccad4aa8` in both
archives. This establishes that the two architecture archives carry the same
model bytes. The pinned phonemizer source release includes the same named
model in its source tree and documents that it is the bundled libtashkeel
model. Its repository-level license is MIT and no model-specific license or
training-data statement is provided. Record that limitation rather than
assigning the model a separate license or claiming its training provenance is
known.

The Piper source revision is MIT-licensed. The bundled phonemization library
identifies itself as version 1.2.0; its pinned
[`2023.11.14-4` source tree](https://github.com/rhasspy/piper-phonemize/tree/2023.11.14-4)
includes an [MIT license](https://github.com/rhasspy/piper-phonemize/blob/2023.11.14-4/LICENSE.md).
Its CMake build definition selects ONNX Runtime `1.14.1` by default and forms
the download URL from that version and the platform-specific release archive
name. The matching upstream
[`ThirdPartyNotices.txt`](https://github.com/microsoft/onnxruntime/blob/v1.14.1/ThirdPartyNotices.txt)
is available and contains notices for ONNX Runtime's third-party components;
the included notices have not yet been mapped to the exact shared library
members in the Piper x86-64 and ARM64 archives.

The [`2023.11.14-4` README](https://github.com/rhasspy/piper-phonemize/blob/2023.11.14-4/README.md)
says Arabic diacritization is supported through
[libtashkeel](https://github.com/mush42/libtashkeel) and that the model is
included. Its [CMake install rule](https://github.com/rhasspy/piper-phonemize/blob/2023.11.14-4/CMakeLists.txt)
identifies the artifact as
[`etc/libtashkeel_model.ort`](https://github.com/rhasspy/piper-phonemize/blob/2023.11.14-4/etc/libtashkeel_model.ort).
The libtashkeel project repository identifies its software as MIT-licensed
and describes its models as trained mainly on MSA data from Hareef. The pinned
phonemizer README and install rule establish that this exact ONNX path is the
model bundled in the source release. Neither source gives the model a
model-specific license or ties that general training description to the
training data for this particular ONNX file.

The `2023.11.14-4` CMake definition pins the eSpeak NG source archive to
commit
[`0f65aa301e0d6bae5e172cc74197d32a6182200f`](https://github.com/espeak-ng/espeak-ng/tree/0f65aa301e0d6bae5e172cc74197d32a6182200f)
and its `COPYING` file identifies GNU GPL version 3. This resolves the source
revision selected by the phonemizer build recipe. The release archives' hashes
and member inventories are recorded above, but the publisher did not include
a build attestation tying each binary member to that build recipe. Treat the
commit as upstream source provenance and the archive as the exact runtime
artifact; do not claim an independently reproducible build. The Piper
[`2023.11.14-2` release workflow](https://github.com/rhasspy/piper/blob/2023.11.14-2/.github/workflows/main.yml)
builds the checked-out Piper tag using its
[Dockerfile](https://github.com/rhasspy/piper/blob/2023.11.14-2/Dockerfile),
which configures and builds from source; the workflow does not record the
resolved dependency tree or archive checksum. The exact upstream source
commit is known from the pinned dependency recipe, while byte-for-byte source
to binary correspondence remains unverified.

The immutable upstream source locations and artifact checksums are recorded,
but there is no retained corresponding-source bundle for the released Piper
binaries. The Tashkeel model's source location and repository-level license
are identified; model-specific terms and training-data provenance are not
published. ONNX Runtime 1.14.1 is identified by the pinned recipe and its
third-party notice file is linked above; the Piper archive does not contain
that notice, so a redistributor should include it with the runtime. This
inventory records evidence and limits; it is not a legal opinion about
obligations.

The checked-in `scripts/checks/inventory-piper-archives.mjs` command verifies
both pinned archive SHA-256 values and emits a sorted member list bound to
those digests. Run it against the release archives after downloading them:

```sh
node scripts/checks/inventory-piper-archives.mjs \
  /path/to/piper_linux_x86_64.tar.gz \
  /path/to/piper_linux_aarch64.tar.gz
```

This is an inventory aid; it rejects archive path traversal and duplicate
member names. The source revision, project-level licenses, runtime archive
hashes, and upstream notice sources are recorded. Remaining evidence limits
are the missing upstream build attestation and bundled corresponding-source
package, model-specific terms/training provenance, and exact applicability of
ONNX Runtime's bundled notices. The first public Jarvis release publishes no
prebuilt image; this entry describes artifacts fetched when an operator
builds one.

### Playwright browser archives

The reviewed archive manifest at
[`plugins/browser/deploy/playwright-archives.json`](plugins/browser/deploy/playwright-archives.json)
records the exact source URL, platform, archive size, and SHA-256 for Chromium,
its headless shell, and FFmpeg on Linux x86-64 and ARM64. The six archives were
downloaded and hashed on 2026-10-13. The pinned
[Playwright 1.59.1 browser manifest](https://raw.githubusercontent.com/microsoft/playwright/v1.59.1/packages/playwright-core/browsers.json)
and [download-path mapping](https://raw.githubusercontent.com/microsoft/playwright/v1.59.1/packages/playwright-core/src/server/registry/index.ts)
identify those revision-specific URLs. The Browser build checks each archive's
size and SHA-256, then serves only those checked bytes to Playwright's installer
over container-local HTTP. Both Linux architecture asset stages built with this
check on the macOS ARM64 development host; the image builds are not fresh-host
release rehearsals.

An archive filename inventory found `WidevineCdm/LICENSE` in x86-64 Chromium,
`LICENSE.headless_shell` in its x86-64 headless shell, and
`COPYING.LGPLv2.1` in both FFmpeg archives. Neither ARM64 Chromium archive
contained a license or notice file by name. These files do not establish the
complete licenses, notices, or corresponding source for all bundled Chromium
and FFmpeg components. The deployed ARM64 Chromium binary reports version
`147.0.7727.0`, which maps to the upstream
[Chromium source tag](https://chromium.googlesource.com/chromium/src/+/refs/tags/147.0.7727.0)
at commit `fa83b76e1f8fd6789673191ae707ac1e5e500e78`; the component license
index is upstream
[`LICENSES.chromium.html`](https://chromium.googlesource.com/chromium/src/+/refs/tags/147.0.7727.0/LICENSES.chromium.html).
Playwright's pinned registry identifies the exact browser archive paths. The
FFmpeg archive is pinned to Playwright build 1011 and its runtime identifies
version `n7.0.1`; the archive contains the LGPL-2.1 license text but does not
identify an exact source commit or static dependency list. Those source-to-
binary and component-notice limits are recorded for any future image
redistribution. The first release remains source-only.

The hash-locked Browser Python runtime also includes certifi (MPL-2.0), cffi
(MIT-0), markdown-it-py (MIT), mdurl (MIT), pycparser (BSD-3-Clause), Pygments
(BSD-2-Clause), and rich (MIT). Their exact versions and artifact hashes are
recorded in `plugins/browser/deploy/requirements.lock`.

Debian and Alpine packages installed while building images retain their own
licenses. The deployed PostgreSQL Alpine packages are inventoried below;
Debian package names, versions, and copyright-file count for the Browser image
are recorded in the deployed inspection above. Retain full per-image package
inventories and notices before distributing any Jarvis runtime image.

## Container images

| Component                        | Release identity                                                                                                                             | License evidence                                                                                                                                                                                                                                                                                                                                                   | Status                                                                                                              |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------- |
| PostgreSQL 16 Alpine             | `docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea` (multi-platform index) | Concrete package versions, declared license expressions, Alpine source commits, and project URLs match across amd64/arm64; see [`deployed-postgres-apk-inventory.md`](docs/development/deployed-postgres-apk-inventory.md). Source commits point to Alpine packaging recipes; upstream source archives and a collected per-package notice bundle are not retained. | **Deployed package inventory and source references recorded**; no Jarvis image is published                         |
| Continuwuity                     | `forgejo.ellis.link/continuwuation/continuwuity@sha256:5cc03961412fb74836a14599cda3bfa17f003df902d9555281fa973976c5243b`                     | Deployed labels identify revision `a237672c90ceafbf46fc2ce9779b7a50ebb3c142`, version `v26.9.0`, and project Apache-2.0 source/license files; the sparse SBOM does not cover Rust dependencies or notices.                                                                                                                                                         | **Source/license target identified; image build/dependency closure unverified**; no Jarvis image is published       |
| Loki, Alloy, Prometheus, Grafana | Optional observability overlay; each image reference is supplied by the operator                                                             | No release-selected digest exists, so exact source, version, license, and notice evidence cannot be identified from this repository                                                                                                                                                                                                                                | **Outside the first-release baseline**; operators enabling the overlay must record and review their selected images |

## JavaScript production dependencies

The authoritative dependency graph is frozen by `pnpm-lock.yaml`. The
[generated production inventory](docs/generated/production-dependency-licenses.json)
contains 442 installed package/version entries and deliberately excludes local
installation paths. `pnpm licenses:check` regenerates the inventory in memory,
rejects missing, unreviewed, or explicitly disallowed licenses, and fails if
the committed inventory is stale. Run `pnpm licenses:generate` after an
intentional dependency change.

The reviewed installed closure currently contains MIT, Apache-2.0, ISC,
BSD-2-Clause, BSD-3-Clause, BlueOak-1.0.0, Unlicense, 0BSD, and the dual choice
`AFL-2.1 OR BSD-3-Clause`. No GPL, AGPL, LGPL, or SSPL entry is accepted by the
policy. On macOS ARM64, `pnpm licenses:check` verified all 442 recorded
production entries, including platform-selected optional dependencies. The
command also invoked four license-policy unit tests; all passed. This shell
reported Node 22.22.0, below the repository's declared Node 24 minimum, so the
check should be repeated under Node 24 before release verification.

## Release requirements

Before publishing any Jarvis runtime image:

- replace every incomplete core-artifact entry with immutable provenance and
  reviewed license evidence;
- include licenses and required notices in the distributed release artifacts;
- validate cross-platform optional dependency metadata on the macOS release
  host;
- select and review the optional observability image set if it is included; and
- verify that changing a downloaded artifact without updating its checksum is
  rejected by automation.

The default voice is `en_US-ljspeech-high`, selected because its model card
records training from scratch on the public-domain LJ Speech dataset. Its
immutable voice revision and checksums are recorded above and are enforced by
the model-init download script. Piper/eSpeak NG provenance is recorded above,
and the upstream build attestation and corresponding-source package are not
included in the publisher's Piper release archives. Preserve the linked
license and notice files with any future redistributed runtime; this source-
only release does not publish that image.
