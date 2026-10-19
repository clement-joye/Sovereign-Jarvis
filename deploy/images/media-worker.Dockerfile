# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG WHISPER_CPP_REVISION=23ee03506a91ac3d3f0071b40e66a430eebdfa1d
ARG WHISPER_CPP_SOURCE_SHA256=c8b0de473e9ec47a74bdf6104425c709261beeada8d6d7c1fec7432be701d032
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_X86_64_SHA256=a50cb45f355b7af1f6d758c1b360717877ba0a398cc8cbe6d2a7a3a26e225992
ARG PIPER_AARCH64_SHA256=fea0fd2d87c54dbc7078d0f878289f404bd4d6eea6e7444a77835d1537ab88eb

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS piper-runtime
ARG PIPER_VERSION
ARG PIPER_X86_64_SHA256
ARG PIPER_AARCH64_SHA256
ARG TARGETARCH
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates curl tar \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /opt
RUN case "${TARGETARCH:-$(dpkg --print-architecture)}" in \
      amd64) piper_arch=x86_64; piper_sha256="${PIPER_X86_64_SHA256}" ;; \
      arm64) piper_arch=aarch64; piper_sha256="${PIPER_AARCH64_SHA256}" ;; \
      *) echo "Unsupported Piper architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
    && curl --fail --location --silent --show-error --http1.1 --retry 5 --retry-delay 2 --retry-all-errors \
      "https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_${piper_arch}.tar.gz" \
      -o /tmp/piper.tar.gz \
    && echo "${piper_sha256}  /tmp/piper.tar.gz" | sha256sum -c - \
    && tar -xzf /tmp/piper.tar.gz -C /tmp \
    && mv /tmp/piper /opt/piper \
    && rm /tmp/piper.tar.gz

FROM debian:bookworm-slim@sha256:3783cc01769c7b2b1b83a5c5ad96c815348e28ed7da68e2e3687004faa906251 AS whisper-build
ARG WHISPER_CPP_REVISION
ARG WHISPER_CPP_SOURCE_SHA256
RUN apt-get update \
    && apt-get install --no-install-recommends -y ca-certificates cmake curl g++ make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
RUN curl --fail --location --silent --show-error --http1.1 --retry 5 --retry-delay 2 --retry-all-errors \
      "https://github.com/ggml-org/whisper.cpp/archive/${WHISPER_CPP_REVISION}.tar.gz" \
      -o /tmp/whisper.cpp.tar.gz \
    && echo "${WHISPER_CPP_SOURCE_SHA256}  /tmp/whisper.cpp.tar.gz" | sha256sum -c - \
    && mkdir whisper.cpp \
    && tar -xzf /tmp/whisper.cpp.tar.gz --strip-components=1 -C whisper.cpp \
    && rm /tmp/whisper.cpp.tar.gz
WORKDIR /src/whisper.cpp
RUN cmake -B build -DWHISPER_BUILD_EXAMPLES=ON -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF \
    && cmake --build build --target whisper-cli --parallel 2

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir=/pnpm/store

FROM deps AS build
COPY apps/media-worker ./apps/media-worker
COPY packages ./packages
COPY tests/integration/package.json ./tests/integration/package.json
COPY tests/system/package.json ./tests/system/package.json
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY scripts ./scripts
RUN pnpm --filter @second-brain/media-worker build

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
ENV NODE_ENV=production
# Match the user's local time so file timestamps, the OS `date` command
# run by the Pi agent under the bash tool, and Node.js `Date#toString()`
# all agree on Europe/Stockholm.
ENV TZ=Europe/Stockholm
WORKDIR /app
RUN apt-get update \
    && apt-get install --no-install-recommends -y ffmpeg libgomp1 tzdata \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone \
    && rm -rf /var/lib/apt/lists/* \
    && addgroup --system brain \
    && adduser --system --ingroup brain brain \
    && mkdir -p /brain/exchange /brain/media-cache /opt/whisper-models /opt/piper-models \
    && chown brain:brain /brain/exchange /brain/media-cache
COPY --from=whisper-build /src/whisper.cpp/build/bin/whisper-cli /usr/local/bin/whisper-cli
COPY --from=piper-runtime /opt/piper /opt/piper
COPY --from=build /app /app
USER brain
CMD ["node", "apps/media-worker/dist/src/index.js"]
