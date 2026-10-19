# Support policy

Jarvis is currently maintained on a best-effort basis by its repository
maintainer.

## Supported versions and platforms

- The latest published stable Jarvis release is supported. Older releases may
  receive no fixes; upgrade before requesting help.
- Arch Linux x86-64 and macOS 26.4 arm64 using Docker Compose are the initial
  production hosts. A different host version is supported only after it is
  listed in the installation documentation for a release.
- Node.js 24 and pnpm 11.5.0 are the repository development and setup toolchain
  versions. They do not establish support for other host components.
- Each release documents its tested Docker, Matrix, and inference API
  compatibility. No broader compatibility range is implied.

Ubuntu 24.04 validation and macOS 15 CI smoke coverage are later work; neither
is an initial support claim. Live application update and automated boot have
not yet been rehearsed on the initial hosts.

## Getting help

Use GitHub Issues for reproducible bugs and feature requests. Include the Jarvis
release, host platform, relevant redacted logs, and the steps that led to the
problem. Remove tokens, passwords, Matrix keys, and personal data before
posting. Use the private process in [SECURITY.md](SECURITY.md) for security
reports.
