export * from "./manifest.js";
export * from "./echo-tools.js";
import { definePluginPackage } from "@second-brain/plugin-sdk";
import { EXAMPLE_ECHO_PLUGIN_MANIFEST_V2 } from "./manifest.js";
import { ECHO_PI_TOOL_PROVIDER } from "./echo-tools.js";
export const EXAMPLE_ECHO_PLUGIN = definePluginPackage({
  manifest: EXAMPLE_ECHO_PLUGIN_MANIFEST_V2,
  piToolProviders: [ECHO_PI_TOOL_PROVIDER]
});
