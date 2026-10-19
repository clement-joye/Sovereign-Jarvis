# syntax=docker/dockerfile:1.7@sha256:a57df69d0ea827fb7266491f2813635de6f17269be881f696fbfdf2d83dda33e
ARG BASE_RUNTIME_IMAGE=jarvis/pi-jarvis:current

# Browser downloads are independent of the Jarvis runtime. Keep them in a
# stable stage so a new base-runtime image does not download Chromium, npm, and
# Python packages again.
FROM node:24-bookworm-slim@sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6 AS browser-assets
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
COPY plugins/browser/deploy/package.json plugins/browser/deploy/package-lock.json /opt/browser-profile/
COPY plugins/browser/deploy/playwright-archives.json plugins/browser/deploy/install-verified-playwright.mjs /opt/browser-profile/
COPY plugins/browser/deploy/requirements.lock /opt/browser-requirements.lock
RUN apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates python3 python3-venv \
  && rm -rf /var/lib/apt/lists/*
RUN --mount=type=cache,id=jarvis-browser-npm-cache,target=/root/.npm \
    --mount=type=cache,id=jarvis-browser-pip-cache,target=/root/.cache/pip \
    npm ci --prefix /opt/browser-profile --omit=dev --ignore-scripts \
  && node -e 'const browsers=require("/opt/browser-profile/node_modules/playwright-core/browsers.json").browsers; for (const [name,revision] of [["chromium","1217"],["chromium-headless-shell","1217"],["ffmpeg","1011"]]) { const browser=browsers.find(x=>x.name===name); if (!browser || browser.revision!==revision) throw new Error(`Unexpected Playwright ${name} revision: ${browser?.revision}`); }' \
  && node /opt/browser-profile/install-verified-playwright.mjs \
  && python3 -m venv /opt/browser-venv \
  && /opt/browser-venv/bin/pip install --require-hashes -r /opt/browser-requirements.lock

FROM ${BASE_RUNTIME_IMAGE} AS browser-runtime

USER root
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright \
    HOME=/opt/profile \
    BROWSER_FETCH_PYTHON=/opt/browser-venv/bin/python
COPY --from=browser-assets /ms-playwright /ms-playwright
COPY --from=browser-assets /opt/browser-profile/node_modules /opt/profile/node_modules
COPY --from=browser-assets /opt/browser-venv /opt/browser-venv
# Browser executable resources remain coupled to the Browser image. Its role
# prompt and skills are supplied by the shared read-only resource bundle.
COPY plugins/browser/resources/extensions/browser /opt/profile/extensions/browser
COPY plugins/browser/resources/browser/bin /opt/profile/browser/bin
RUN --mount=type=cache,id=jarvis-browser-apt-cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,id=jarvis-browser-apt-lists,target=/var/lib/apt/lists,sharing=locked \
    apt-get update \
  && apt-get install --no-install-recommends --yes ca-certificates jq python3 python3-venv w3m \
  && /opt/profile/node_modules/.bin/playwright install-deps chromium \
  && chown -R workspace:workspace /ms-playwright /opt/profile /opt/browser-venv
ENV PI_ALLOWED_TOOLS=websearch,web_fetch,browser_navigate,browser_scroll,browser_extract,browser_back,browser_history,browser_click,browser_type
USER workspace
