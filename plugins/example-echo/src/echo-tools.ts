import { Type } from "@earendil-works/pi-ai";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { definePiToolProvider } from "@second-brain/plugin-sdk";

export const ECHO_PI_TOOL_PROVIDER = definePiToolProvider({
  implementationId: "example-echo-tools",
  create: () => [
    defineTool({
      name: "echo",
      label: "Echo",
      description: "Echo text.",
      parameters: Type.Object({ text: Type.String() }),
      execute: async (_id, params) => ({
        content: [{ type: "text", text: params.text }],
        details: {}
      })
    })
  ]
});
