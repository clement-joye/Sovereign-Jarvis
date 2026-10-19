# media-worker

## Role

Speech and media processing worker. Handles STT (speech-to-text) and TTS (text-to-speech).

## responsibility

- Transcribe audio messages from Matrix into text via Whisper.cpp.
- Synthesize text responses into audio via Piper TTS.
- Cache transcription results to avoid redundant processing.
- Normalize audio (resample, volume normalization) before transcription.

## Integration

```
brain-worker ──HTTP──▶ media-worker
       │                        │
       │   (STT result)         │
       ▼                        ▼
brain-control              audio file
```

- **Upstream dependency**: `brain-control` (claims media processing jobs via HTTP API).
- **Downstream calls**: None. Processes jobs and reports outcomes back to brain-control.
- **No database access**: Communicates exclusively via brain-control's HTTP API.
- **External tools**: Depends on `whisper.cpp` and `piper` binaries on the host.

## Key packages

| Package                       | Purpose                                      |
| ----------------------------- | -------------------------------------------- |
| `@second-brain/media-adapter` | STT/TTS implementations, transcription cache |
| `@second-brain/contracts`     | Schema types                                 |

## Entry point

`src/index.ts` — bootstraps the media processor pipeline and HTTP server for job processing.
