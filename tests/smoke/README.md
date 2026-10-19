# Smoke Tests

Smoke tests exercise real optional dependencies that are intentionally not deterministic enough for normal CI assertions.

Rules:

- Keep the suite small.
- Gate it behind explicit environment variables.
- Assert structure, persistence, and delivery, not exact model wording.
- Record enough diagnostics to distinguish wiring failures from model-quality issues.
