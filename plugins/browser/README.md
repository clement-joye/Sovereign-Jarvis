# Browser plugin

`browser` provides the optional `@browser` agent for public web research and
isolated browser automation. It has no workspace filesystem access and does
not require credentials.

## Deploy and enable

The normal host-local update discovers [`runtime.json`](runtime.json), builds
the dedicated Browser image, and publishes its immutable image ID in the
platform catalog:

```sh
node scripts/runtime/update-host-local-runtime-profile.mjs \
  --platform-catalog-dir /absolute/path/to/jarvis-platform-catalog
```

Then enable it from the workspace's Matrix room:

```text
/plugin enable browser
/plugin status browser
```

No `key=value` configuration or credential reference is needed.

## Use

Call Browser directly or delegate to it through the permitted Orchestrator agent:

```text
@browser Find today's weather in Stockholm and cite the sources.
@orchestrator Ask @browser to compare these two public web pages.
```

Search, public-page retrieval, navigation, scrolling, extraction, and history
are observation operations. Click and type can change an external website, so
they create durable owner approval proposals. Reply to the dedicated approval
message with `/yes` or `/no`. The proposal remains valid for 24 hours; never treat an ordinary chat confirmation
as approval.

Browser will not type into password or file inputs, upload files, access
private network addresses, or bypass access controls and challenges.

## Disable and troubleshoot

```text
/plugin disable browser
```

- If `@browser` is unavailable, check `/plugin status browser` in that room.
- If its runtime image is unavailable, rerun the host-local update and inspect
  the `browser` runtime image in `current-runtime.json`.
- For delegation failures, confirm both the workspace binding and the parent
  agent's reviewed delegation policy permit Browser and the requested tools.

See the full [Browser operations guide](../../docs/operations/browser-agent.md)
and the reviewed [plugin manifest](src/manifest.ts).
