# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
RUN corepack enable
# Fetching from the lockfile keeps package downloads in the BuildKit cache when
# source files change. The complete workspace is copied only for compilation.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir=/pnpm/store
COPY deploy/pi-runtime/npm/package.json deploy/pi-runtime/npm/package-lock.json /opt/profile-dependencies/
RUN --mount=type=cache,id=jarvis-profile-npm-cache,target=/root/.npm \
    npm ci --prefix /opt/profile-dependencies --omit=dev --ignore-scripts
COPY apps/pi-runner ./apps/pi-runner
COPY packages ./packages
COPY plugins ./plugins
# Referenced package tests are typechecked by the composite build and import
# host-only release tooling. Its declarations satisfy that boundary without
# making operational script implementations runtime-image build inputs.
COPY scripts/runtime/*.d.mts ./scripts/runtime/
COPY scripts/plugins/*.d.mts ./scripts/plugins/
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store \
  && pnpm --filter @second-brain/pi-runner build \
  && pnpm --filter @second-brain/pi-runner deploy --legacy --prod /runtime

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS profile-base
ENV NODE_ENV=production \
    PI_PROFILE_ROOT=/opt/profile \
    PI_RUNNER_IMPLEMENTATION=pi-coding-agent \
    PI_SESSION_ROOT=/sessions \
    PI_WORKSPACE_ROOT=/workspace \
    PI_MODELS_PATH=/opt/profile/models.json
RUN apt-get update \
  && apt-get install --no-install-recommends --yes curl tesseract-ocr \
  && rm -rf /var/lib/apt/lists/*
RUN groupadd --system --gid 65532 workspace \
  && useradd --system --uid 65532 --gid workspace --no-create-home workspace
RUN mkdir -p /workspace /sessions /var/lib/jarvis/platform-catalog \
  && chown workspace:workspace /workspace /sessions /var/lib/jarvis/platform-catalog
WORKDIR /workspace
# The Pi SDK comes from the application deployment. Package only the local
# model definition and plugin-selected extension; role prompts and skills are
# published separately as a digest-addressed read-only bundle.
COPY deploy/pi-runtime/models.json /opt/profile/models.json
COPY plugins/core-agents/resources/extensions /opt/profile/extensions
COPY --from=build /runtime /app
# Extensions are imported from /opt/profile/extensions. Keep their locked
# dependencies at the profile root so Node's normal upward resolution finds
# them, without exposing the application dependency tree as profile state.
COPY --from=build /opt/profile-dependencies/node_modules /opt/profile/node_modules
COPY deploy/pi-runtime/npm/package.json /opt/profile/package.json
RUN chown -R workspace:workspace /opt/profile /workspace /sessions
USER workspace
# A runtime executor must supply the Pi SDK entrypoint and only the reviewed
# SDK-compatible extension set. This image intentionally has no installer or
# browser binary and performs no privileged setup at container startup.
# `pnpm deploy` places the pi-runner package itself at /app, rather than its
# original monorepo location. Keep this aligned with its package `start` script.
CMD ["node", "/app/dist/src/index.js"]

# The shared runtime contains the immutable plugin composition. Pi loads one
# catalog-selected role per session; authority remains policy-derived.
FROM profile-base AS base-runtime
