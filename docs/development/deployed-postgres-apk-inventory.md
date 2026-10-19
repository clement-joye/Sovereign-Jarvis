# PostgreSQL Alpine package metadata (deployed ARM64 and pinned AMD64)

Captured 2026-10-14 from the read-only APK database in the running
`jarvis-brain-db-1` container on the macOS ARM64 Docker host. The container
uses PostgreSQL image index
`docker.io/library/postgres:16.15-alpine3.24@sha256:721873c34ceb9f8d8fc265984940dc982404c105f19ad51be9fdc5970a6080ea`,
resolved locally as `linux/arm64` child manifest
`sha256:2c942175a1255a9abe0366e48c1b401d9f50f835b04dfea13f111609b5530df7`;
the root filesystem reports Alpine `3.24.2`. This is a package-manager
inventory of the deployed ARM64 platform image, with a comparison against the
same pinned index on amd64; it is not a new Jarvis image build.

The installed APK database declares each package's version, license
expression, Alpine origin package, package commit, and project URL. Alpine's
[APK metadata specification](https://wiki.alpinelinux.org/wiki/Apk_spec)
defines the package `commit` field as the commit from which the package was
built. License expressions are reproduced as declared; multi-license
expressions and package contents have not been independently interpreted.
The Alpine package commit identifies the packaging/source commit, but does not
by itself identify every upstream source archive used by that APKBUILD.
These records do not contain corresponding source archives or prove that
all license texts/notices are present in the image. Review those from the
identified Alpine package commits before closing image license/source
coverage.

### amd64 comparison (2026-10-14)

The exact pinned image index was also started once as `linux/amd64`; only its
APK database was read, and the temporary container was removed. Its child
manifest is `sha256:1a66d744c1b459e13b05a8fca341da84cb63383e99ce262210efee5a319d4551`.
The amd64 image reports Alpine `3.24.2`. Its 44 concrete APK packages match
the ARM64 table above in version, declared license, origin package, and Alpine
package commit. The only additional entry is the virtual
`.postgresql-rundeps` meta-package, which has no declared license and no source
files. Thus the table above is also the concrete package/license inventory
for amd64; package artifacts and binary file hashes remain architecture
specific. The raw amd64 APK database was captured temporarily for this
comparison and is not checked in.

| APK package | Version | Declared license | Alpine origin | Package commit | Project URL |
| --- | --- | --- | --- | --- | --- |
| alpine-baselayout | 3.7.2-r1 | GPL-2.0-only | alpine-baselayout | 60a7585bbab2fa0f762504eb617dbca90216e31f | <https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/main/alpine-baselayout> |
| alpine-baselayout-data | 3.7.2-r1 | GPL-2.0-only | alpine-baselayout | 60a7585bbab2fa0f762504eb617dbca90216e31f | <https://gitlab.alpinelinux.org/alpine/aports/-/tree/master/main/alpine-baselayout> |
| alpine-keys | 2.6-r0 | MIT | alpine-keys | b9f23becced4d7b3ccc0fa0f28530243ccd314a0 | <https://alpinelinux.org> |
| alpine-release | 3.24.2-r0 | MIT | alpine-base | d9d560d5de74ff9a7a73f3c903d6f126a0bf3142 | <https://alpinelinux.org> |
| apk-tools | 3.0.8-r0 | GPL-2.0-only | apk-tools | 4588b452722bd4800efdc6cce4f6e980e02a997f | <https://gitlab.alpinelinux.org/alpine/apk-tools> |
| bash | 5.3.9-r1 | GPL-3.0-or-later | bash | 1522c3193610902d8493f9790a2755c11f21f26d | <https://www.gnu.org/software/bash/bash.html> |
| busybox | 1.37.0-r31 | GPL-2.0-only | busybox | c3ef5d10e6ef6528852c51f0564963e2f8c1be19 | <https://busybox.net/> |
| busybox-binsh | 1.37.0-r31 | GPL-2.0-only | busybox | c3ef5d10e6ef6528852c51f0564963e2f8c1be19 | <https://busybox.net/> |
| ca-certificates-bundle | 20260909-r0 | MPL-2.0 AND MIT | ca-certificates | eb7078df3a16d666e8f7723f94bb92e00d4b9236 | <https://www.mozilla.org/en-US/about/governance/policies/security-group/certs/> |
| gdbm | 1.26-r0 | GPL-3.0-or-later | gdbm | 1ea03990396db618edfcc8a9a0bc6b72662bac8f | <https://www.gnu.org/software/gdbm/> |
| icu-data-full | 78.1-r0 | ICU | icu | 6755fdb21483ba250d374c3244f0f48bc63447e2 | <https://icu.unicode.org/> |
| icu-libs | 78.1-r0 | ICU | icu | 6755fdb21483ba250d374c3244f0f48bc63447e2 | <https://icu.unicode.org/> |
| keyutils-libs | 1.6.3-r4 | GPL-2.0-or-later AND LGPL-2.0-or-later | keyutils | 8bac74716d06c84627ab02d101fd9d2bafd0a34c | <https://people.redhat.com/~dhowells/keyutils/> |
| krb5-conf | 1.0-r2 | MIT | krb5-conf | 4a46b2cb955e25fd6d6f913794d35bc6d876aea9 | <https://web.mit.edu/kerberos/www/> |
| krb5-libs | 1.22.2-r1 | MIT | krb5 | 92bc4f0d36aa5307e819fb57167fc19952cf515f | <https://web.mit.edu/kerberos/www/> |
| libapk | 3.0.8-r0 | GPL-2.0-only | apk-tools | 4588b452722bd4800efdc6cce4f6e980e02a997f | <https://gitlab.alpinelinux.org/alpine/apk-tools> |
| libcom_err | 1.47.4-r0 | GPL-2.0-or-later AND LGPL-2.0-or-later AND BSD-3-Clause AND MIT | e2fsprogs | 8683a6972cb245fbbdb535dad6435a9930bb9374 | <https://e2fsprogs.sourceforge.net/> |
| libcrypto3 | 3.5.8-r0 | Apache-2.0 | openssl | 013edf8b29199933e8ea34dde460b5584b979042 | <https://www.openssl.org/> |
| libedit | 20260508.3.1-r1 | BSD-3-Clause | libedit | 7c805161e588c028cdee3f19f500849fb2c75d42 | <https://www.thrysoee.dk/editline> |
| libffi | 3.5.2-r1 | MIT | libffi | 2c2a7bb4a8b16066834e90402567b2c19403a790 | <https://sourceware.org/libffi/> |
| libgcc | 15.2.0-r5 | GPL-2.0-or-later AND LGPL-2.1-or-later | gcc | 423a8ad043d07f2c7546c8ec3e2b0384cda360ae | <https://gcc.gnu.org> |
| libldap | 2.6.14-r0 | OLDAP-2.8 | openldap | 1f9cbd23a8be05afabdd96072263ba025e097c8f | <https://www.openldap.org/> |
| libncursesw | 6.6_p20260516-r0 | X11 | ncurses | 2cee8a7328d061418336ad327b512d96bcd7bc5e | <https://invisible-island.net/ncurses/> |
| libsasl | 2.1.28-r9 | BSD-3-Clause-Attribution AND BSD-4-Clause | cyrus-sasl | fac808c0fddf93e8980ec1f55972e6f69b78ba6f | <https://www.cyrusimap.org/sasl/> |
| libssl3 | 3.5.8-r0 | Apache-2.0 | openssl | 013edf8b29199933e8ea34dde460b5584b979042 | <https://www.openssl.org/> |
| libstdc++ | 15.2.0-r5 | GPL-2.0-or-later AND LGPL-2.1-or-later | gcc | 423a8ad043d07f2c7546c8ec3e2b0384cda360ae | <https://gcc.gnu.org> |
| libuuid | 2.42.3-r1 | BSD-3-Clause | util-linux | d98c55af59055e6ca60fbe36e171546918709965 | <https://git.kernel.org/cgit/utils/util-linux/util-linux.git> |
| libverto | 0.3.2-r2 | MIT | libverto | 84a227baf001b6e0208e3352b294e4d7a40e93de | <https://github.com/latchset/libverto> |
| libxml2 | 2.13.9-r2 | MIT | libxml2 | f1bd5b6767a0e7fdda380c95138a1c938eb6e102 | <https://gitlab.gnome.org/GNOME/libxml2> |
| libxslt | 1.1.43-r3 | X11 | libxslt | 730f2f5bdc97be98b2beee33f55134c622e6189c | <http://xmlsoft.org/XSLT/> |
| llvm21-libs | 21.1.8-r1 | Apache-2.0 | llvm21 | 4b9b094db09064adf09759b02ce63d23ab3d8cbb | <https://llvm.org/> |
| lz4-libs | 1.10.0-r1 | BSD-2-Clause AND GPL-2.0-or-later | lz4 | 1f16962f34234a77fab0f4651459c4381b4a0cd6 | <https://github.com/lz4/lz4> |
| musl | 1.2.6-r2 | MIT | musl | f5640d3a10f664c9119720c60515265d3d6f6d01 | <https://musl.libc.org/> |
| musl-utils | 1.2.6-r2 | MIT AND BSD-2-Clause AND GPL-2.0-or-later | musl | f5640d3a10f664c9119720c60515265d3d6f6d01 | <https://musl.libc.org/> |
| ncurses-terminfo-base | 6.6_p20260516-r0 | X11 | ncurses | 2cee8a7328d061418336ad327b512d96bcd7bc5e | <https://invisible-island.net/ncurses/> |
| nss_wrapper | 1.1.12-r1 | BSD-3-Clause | nss_wrapper | 44ce39a091100c59a3bd90df6c0312d302be3171 | <https://cwrap.org/nss_wrapper.html> |
| readline | 8.3.3-r1 | GPL-3.0-or-later | readline | a854c03acdac188901fb012f7acbee70a36e8041 | <https://tiswww.cwru.edu/php/chet/readline/rltop.html> |
| scanelf | 1.3.9-r1 | GPL-2.0-only | pax-utils | c61801eeacb3ffcd9c2025b09e402153bb93fb39 | <https://wiki.gentoo.org/wiki/Hardened/PaX_Utilities> |
| ssl_client | 1.37.0-r31 | GPL-2.0-only | busybox | c3ef5d10e6ef6528852c51f0564963e2f8c1be19 | <https://busybox.net/> |
| tzdata | 2026d-r0 | Public-Domain | tzdata | a19caf9fe771707618d4d9e4fa2dd9db8155b461 | <https://www.iana.org/time-zones> |
| xz-libs | 5.8.4-r0 | GPL-2.0-or-later AND 0BSD AND Public-Domain AND LGPL-2.1-or-later | xz | 0c088d609f9fe69eedd6b4c7f4b99cdad847c20a | <https://tukaani.org/xz/> |
| zlib | 1.3.2-r0 | Zlib | zlib | f248b33b5943c7dc69bf691031d7612ab2e8ed93 | <https://zlib.net/> |
| zstd | 1.5.7-r2 | BSD-3-Clause OR GPL-2.0-or-later | zstd | 3c6e2ee2b16f403d53eab39c4426eb61f003c322 | <https://facebook.github.io/zstd/> |
| zstd-libs | 1.5.7-r2 | BSD-3-Clause OR GPL-2.0-or-later | zstd | 3c6e2ee2b16f403d53eab39c4426eb61f003c322 | <https://facebook.github.io/zstd/> |
