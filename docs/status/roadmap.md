# Roadmap

This records deliberately deferred work, not historical implementation detail.

## Optional VM isolation

Workspace runtimes use constrained Docker containers today. A microVM layer is
a future defence-in-depth enhancement if workloads execute materially
less-trusted content or need stronger kernel isolation.

## Hardware-accelerated speech-to-text

The supported baseline is local `whisper.cpp`. A GPU-specific profile may be added when there is a concrete operational need; it must preserve model provenance, resource limits, and test coverage.

## Real-dependency coverage

The default suite already covers PostgreSQL and a full Compose Matrix stack. Future work may add migration rehearsal from older production schemas and an opt-in real-model smoke environment.

## Future workspace topology

v2 intentionally maps one Matrix room to one workspace. The durable binding design can support multiple rooms per workspace later, but that needs explicit authorization, session, and retention semantics first.
