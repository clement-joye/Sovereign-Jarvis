# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG APP_NAME
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS base
WORKDIR /app
RUN corepack enable

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY tsconfig.json tsconfig.base.json ./
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm fetch --frozen-lockfile --store-dir=/pnpm/store

FROM deps AS build
ARG APP_NAME
COPY apps/${APP_NAME} ./apps/${APP_NAME}
COPY packages ./packages
COPY plugins ./plugins
COPY tests/integration/package.json ./tests/integration/package.json
COPY tests/system/package.json ./tests/system/package.json
RUN --mount=type=cache,id=jarvis-pnpm-store,target=/pnpm/store \
    pnpm install --frozen-lockfile --store-dir=/pnpm/store
COPY scripts ./scripts
COPY deploy/scripts ./deploy/scripts
COPY tests/system/compose/workspace-runtime-stub.mjs ./tests/system/compose/workspace-runtime-stub.mjs
RUN pnpm --filter "@second-brain/${APP_NAME}" build

FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS runtime
ENV NODE_ENV=production
ENV TZ=Europe/Stockholm
WORKDIR /app
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates git poppler-utils tzdata unzip \
  && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
  && echo $TZ > /etc/timezone \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd --system brain \
  && useradd --system --gid brain --create-home brain \
  && mkdir -p /brain/exchange /brain/matrix-crypto /var/lib/jarvis/platform-catalog \
  && touch /brain/models.json \
  && chown brain:brain /brain/exchange /brain/matrix-crypto /brain/models.json /var/lib/jarvis/platform-catalog
COPY --from=build /app /app
ARG APP_NAME
ENV APP_NAME=${APP_NAME}
USER brain
CMD ["sh", "-c", "node apps/${APP_NAME}/dist/src/index.js"]
