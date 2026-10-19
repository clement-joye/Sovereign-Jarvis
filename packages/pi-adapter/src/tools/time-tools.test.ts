import { describe, expect, it } from "vitest";

import { createCurrentTimeTool } from "./time-tools.js";

describe("time_now tool", () => {
  it("returns one authoritative instant in UTC and the configured user timezone", async () => {
    const tool = createCurrentTimeTool({
      timezone: "Europe/Stockholm",
      now: () => new Date("2026-07-31T10:15:30.000Z")
    });

    const result = await tool.execute(
      "call-1",
      {},
      new AbortController().signal,
      () => undefined,
      {} as never
    );
    const content = result.content[0];

    expect(content?.type).toBe("text");
    if (!content || content.type !== "text") throw new Error("Expected text time result.");
    expect(JSON.parse(content.text)).toEqual({
      utc: "2026-07-31T10:15:30.000Z",
      timezone: "Europe/Stockholm",
      local: "2026-07-31T12:15:30+02:00"
    });
  });

  it("returns UTC only when Matrix has no timezone profile field", async () => {
    const tool = createCurrentTimeTool({ now: () => new Date("2026-07-31T10:15:30.000Z") });
    const result = await tool.execute(
      "call-1",
      {},
      new AbortController().signal,
      () => undefined,
      {} as never
    );
    const content = result.content[0];

    if (!content || content.type !== "text") throw new Error("Expected text time result.");
    expect(JSON.parse(content.text)).toEqual({ utc: "2026-07-31T10:15:30.000Z", timezone: null });
  });
});
