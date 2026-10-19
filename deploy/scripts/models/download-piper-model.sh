#!/bin/sh
set -eu

model=/opt/piper-models/en_US-ljspeech-high.onnx
config="${model}.json"
model_url=https://huggingface.co/rhasspy/piper-voices/resolve/bae641dcb5a608cff81ccaf7ff018baaca1a33e1/en/en_US/ljspeech/high/en_US-ljspeech-high.onnx

if [ -f "$model" ]; then
  echo "$PIPER_MODEL_SHA256  $model" | sha256sum -c -
else
  curl -fsSL "$model_url" -o "${model}.tmp"
  echo "$PIPER_MODEL_SHA256  ${model}.tmp" | sha256sum -c -
  mv "${model}.tmp" "$model"
fi

if [ -f "$config" ]; then
  echo "$PIPER_MODEL_CONFIG_SHA256  $config" | sha256sum -c -
else
  curl -fsSL "${model_url}.json" -o "${config}.tmp"
  echo "$PIPER_MODEL_CONFIG_SHA256  ${config}.tmp" | sha256sum -c -
  mv "${config}.tmp" "$config"
fi
