import {
  CORE_PLUGIN_MANIFEST_V2,
  CORE_REVIEWED_MODELS_V2,
  coreRuntimeClassesV2,
  type CoreRuntimeImagePinsV2
} from "@second-brain/core-agents-plugin/manifest";
import {
  BROWSER_PLUGIN_MANIFEST_V2,
  browserRuntimeClassV2
} from "@second-brain/browser-plugin/manifest";
import { EXAMPLE_ECHO_PLUGIN_MANIFEST_V2 } from "@second-brain/example-echo-plugin/manifest";

export const INSTALLED_PLUGIN_MANIFESTS_V2 = Object.freeze([
  CORE_PLUGIN_MANIFEST_V2,
  BROWSER_PLUGIN_MANIFEST_V2,
  EXAMPLE_ECHO_PLUGIN_MANIFEST_V2
]);
export const INSTALLED_LOCAL_TOOL_FACTORY_IDS_V2 = Object.freeze([
  ...new Set(
    INSTALLED_PLUGIN_MANIFESTS_V2.flatMap(({ localToolProviders }) =>
      localToolProviders.map(({ factoryId }) => factoryId)
    )
  )
]);
export const INSTALLED_PLUGIN_BROKER_PROVIDER_IDS_V2 = Object.freeze([
  ...new Set(
    INSTALLED_PLUGIN_MANIFESTS_V2.flatMap(({ brokerProviders }) =>
      brokerProviders.map(({ providerId }) => providerId)
    )
  )
]);
export const INSTALLED_REVIEWED_MODELS_V2 = Object.freeze([...CORE_REVIEWED_MODELS_V2]);

export interface InstalledRuntimeImagePinsV2 extends CoreRuntimeImagePinsV2 {
  browser: string;
}

/** Resolves plugin-owned runtime policies against deployment-supplied image pins. */
export function installedRuntimeClassesV2(
  images: InstalledRuntimeImagePinsV2
): ReturnType<typeof coreRuntimeClassesV2> {
  return [...coreRuntimeClassesV2(images), browserRuntimeClassV2(images.browser)];
}
