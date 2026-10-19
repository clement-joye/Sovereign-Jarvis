import { describe, expect, it } from "vitest";
import { ECHO_PI_TOOL_PROVIDER } from "./echo-tools.js";

describe("echo tool", () => {
  it("returns supplied text", async () => {
    const tool = ECHO_PI_TOOL_PROVIDER.create({} as never)[0]!;
    const result = await tool.execute(
      "call",
      { text: "hello" },
      new AbortController().signal,
      () => undefined,
      {} as never
    );
    expect(result.content).toEqual([{ type: "text", text: "hello" }]);
  });
});
