# Browser agent setup and use

The `browser` plugin provides the optional `@browser` agent, public-page
retrieval, an isolated Playwright/Chromium runtime, and owner-approved click and
type operations. The plugin owns its agent resources, tools, broker handlers,
runtime image, and runtime policy. It does not require credentials.

## Deploy the plugin runtime

The normal host-local update discovers `plugins/browser/runtime.json`, builds
the Browser image from the reviewed shared runtime, records its immutable image
ID, and publishes it in the platform catalog:

```sh
node scripts/runtime/update-host-local-runtime-profile.mjs \
  --platform-catalog-dir /absolute/path/to/jarvis-platform-catalog
```

To build plugin runtime images independently after the shared runtime image
already exists, run `pnpm plugin:runtime:build`.

## Enable Browser in a workspace

From the workspace's Matrix room, the owner sends:

```text
/plugin enable browser
/plugin status browser
```

The Browser agent then works directly:

```text
@browser Find today's weather in Stockholm and cite the source.
```

It can also be selected as a delegated child by the reviewed Orchestrator:

```text
@orchestrator Ask @browser to find today's weather in Stockholm.
```

The workspace binding must be enabled for both direct and delegated Browser
runs. Disable it with `/plugin disable browser`.

## Interaction and approvals

Navigation, extraction, scrolling, history, and public static-page retrieval
are observation operations. `browser_click` and `browser_type` can mutate an
external website and therefore create a durable owner proposal. The operation
runs only after the owner replies to its dedicated approval message with
`/yes`. Reply with `/no` to reject it. Each prompt is bound to one proposal and
remains valid for 24 hours. Password fields, file fields, hidden selectors,
expired proposals, and missing browser sessions fail closed.

Browser containers have no workspace mount. They run on the dedicated
browser-restricted network with bounded temporary storage and cannot access
private, loopback, link-local, or metadata addresses.

## Troubleshooting

- Agent unavailable: confirm `/plugin status browser` reports an enabled
  workspace binding.
- Runtime image unavailable: run the normal host-local update and verify that
  `current-runtime.json` contains `runtimeImageIds.browser`.
- Browser action control unavailable: navigate first so an active Playwright
  page exists before approving click or type.
- Delegation denied: confirm Browser is enabled and the delegating agent's
  manifest permits the `browser` target and requested tools.
