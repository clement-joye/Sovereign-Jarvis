import { describe, expect, it } from "vitest";
import { PiPromptAssembler } from "./pi-prompt-assembler.js";

describe("PiPromptAssembler", () => {
  const assembler = new PiPromptAssembler();
  const now = new Date("2026-08-29T12:34:56.000Z");

  it("preserves the profile and host safety prompts and live clock context", () => {
    expect(assembler.appendSystemPrompt(true, now, "Europe/Stockholm")).toEqual([
      "The Jarvis workspace is the current working directory. Use the workspace_* tools with relative paths for workspace files. Your reviewed role instructions and skills are already injected from the immutable runtime profile; do not search for them in the workspace or claim they are unavailable because AGENTS.md or .agents/skills is absent. The tools registered for this run are authoritative: use a listed tool when its description and injected skill apply, and report a capability as unavailable only when it is not listed.",
      "[Current time: 2026-08-29T12:34:56.000Z UTC; local (Europe/Stockholm): 2026-08-29T14:34:56+02:00.]"
    ]);
    expect(assembler.appendSystemPrompt(false, now)).toEqual([
      "The Jarvis workspace is the current working directory. Use the workspace_* tools with relative paths for all workspace files. AGENTS.md and .agents/skills are read-only: never modify them. To follow an available skill, use workspace_read on its relative .agents/skills/<skill-name>/SKILL.md path.",
      "[Current time: 2026-08-29T12:34:56.000Z UTC.]"
    ]);
  });

  it("assembles document text and attachment/file-return instructions", () => {
    expect(assembler.userPrompt("Please summarize", "Attached text", "run-123")).toBe(
      "Please summarize\n\nAttached text\n\nIf the user explicitly asks to retain an attachment, use attachment_save and link its returned path from the canonical note. If the user asks for a file to be returned, write only the finished artifact to .outbox/run-123/."
    );
  });
});
