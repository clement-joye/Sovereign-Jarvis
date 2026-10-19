import { definePiToolProvider, definePluginPackage } from "@second-brain/plugin-sdk";
import { BROWSER_PLUGIN_MANIFEST_V2 } from "./manifest.js";
import {
  BROWSER_CONTROL_PI_TOOL_PROVIDER,
  BrowserActionService,
  createBrowserBrokerHandler,
  HttpBrowserActionExecutor
} from "./browser-control.js";
import { createBrowserPrivilegedHandler } from "./privileged-handler.js";

export * from "./manifest.js";
export * from "./browser-control.js";
export * from "./privileged-handler.js";

export const BROWSER_TOOLS_PI_PROVIDER = definePiToolProvider({
  implementationId: "browser-tools",
  create: () => []
});

export const BROWSER_PLUGIN = definePluginPackage({
  manifest: BROWSER_PLUGIN_MANIFEST_V2,
  piToolProviders: [BROWSER_TOOLS_PI_PROVIDER, BROWSER_CONTROL_PI_TOOL_PROVIDER],
  brokerHandlerFactories: [
    {
      implementationId: "browser-control",
      create(context) {
        return createBrowserBrokerHandler(
          new BrowserActionService(
            new HttpBrowserActionExecutor(
              context.privilegedBroker.baseUrl,
              context.privilegedBroker.token
            ),
            context.proposals,
            context.operations
          )
        );
      }
    }
  ],
  privilegedHandlerFactories: [
    {
      implementationId: "browser-control",
      create: createBrowserPrivilegedHandler
    }
  ]
});
