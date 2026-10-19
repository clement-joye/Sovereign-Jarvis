#!/bin/sh
set -eu

model=/opt/whisper-models/ggml-small.bin

if [ -f "$model" ]; then
  echo "$WHISPER_CPP_MODEL_SHA256  $model" | sha256sum -c -
  exit 0
fi

curl -fsSL "$WHISPER_CPP_MODEL_URL" -o "${model}.tmp"
echo "$WHISPER_CPP_MODEL_SHA256  ${model}.tmp" | sha256sum -c -
mv "${model}.tmp" "$model"
