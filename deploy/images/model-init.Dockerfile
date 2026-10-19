FROM alpine:3.20@sha256:d9e853e87e55526f6b2917df91a2115c36dd7c696a35be12163d44e6e2a4b6bc

RUN apk add --no-cache coreutils curl

COPY deploy/scripts/models/download-piper-model.sh /usr/local/bin/download-piper-model
COPY deploy/scripts/models/download-whisper-model.sh /usr/local/bin/download-whisper-model
