# Real Model Smoke Tests

Purpose:

- Prove wiring against the actual Pi/model/STT/TTS environment.

Target checks:

- Text request returns a non-empty Matrix response.
- Image request reaches the multimodal path.
- Voice note reaches transcription.
- Pi tool request creates a schedule.
- Generated audio request produces a playable media file.

These checks are release confidence signals, not a replacement for deterministic system tests.
