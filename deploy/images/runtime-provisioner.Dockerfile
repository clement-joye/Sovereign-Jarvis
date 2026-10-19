# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS build
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json tsconfig.base.json ./
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir=/pnpm/store
COPY apps/runtime-provisioner ./apps/runtime-provisioner
COPY packages ./packages
COPY plugins ./plugins
COPY tests/integration/package.json ./tests/integration/package.json
COPY tests/system/package.json ./tests/system/package.json
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY scripts ./scripts
RUN pnpm --filter @second-brain/runtime-provisioner build

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates docker.io \
  && mkdir -p /var/lib/jarvis/platform-catalog \
  && rm -rf /var/lib/apt/lists/*
COPY --from=build /app /app
CMD ["node", "apps/runtime-provisioner/dist/src/index.js"]
