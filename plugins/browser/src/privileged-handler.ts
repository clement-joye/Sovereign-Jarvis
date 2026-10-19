import type { PrivilegedHandlerFactoryContext } from "@second-brain/plugin-sdk";
import type { PrivilegedBrokerHandler } from "@second-brain/application";

export function createBrowserPrivilegedHandler(
  runtime: Pick<PrivilegedHandlerFactoryContext, "executeRuntimeAction">
): PrivilegedBrokerHandler {
  return {
    implementationId: "browser-control",
    async execute(input) {
      if (input.operationId !== "browser-click" && input.operationId !== "browser-type") {
        throw new Error("Unsupported browser action.");
      }
      return await runtime.executeRuntimeAction(
        input.workspaceId,
        "browser",
        input.operationId,
        input.parameters
      );
    }
  };
}
