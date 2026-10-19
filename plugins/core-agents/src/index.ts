export * from "./manifest.js";
import { definePluginPackage } from "@second-brain/plugin-sdk";
import { CORE_PLUGIN_MANIFEST_V2 } from "./manifest.js";
export const CORE_PLUGIN = definePluginPackage({
  manifest: CORE_PLUGIN_MANIFEST_V2
});
