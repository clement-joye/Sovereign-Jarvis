# Example Echo plugin

`example-echo` is a minimal workspace plugin used as a reference implementation
and smoke-test capability. Its `@echo` agent returns supplied text through the
local `echo` tool. It has no filesystem, process, network, credential, or
external side-effect access.

## Enable and use

From the target workspace's Matrix room:

```text
/plugin enable example-echo
/plugin status example-echo
@echo Echo this text exactly: hello from Jarvis
```

The plugin has no configuration keys and requires no host setup. Disable it
with:

```text
/plugin disable example-echo
```

This plugin is primarily an authoring example. Its structure demonstrates a
manifest, agent resources, a local tool provider, and package registration.
Start with the [plugin authoring guide](../../docs/development/plugin-authoring.md)
before copying or extending it. The exact contract is in
[`src/manifest.ts`](src/manifest.ts).
