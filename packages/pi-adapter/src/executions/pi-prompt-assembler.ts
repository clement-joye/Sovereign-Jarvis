import { currentTimeContext } from "../tools/time-tools.js";

const PROFILE_RUNTIME_SYSTEM_PROMPT =
  "The Jarvis workspace is the current working directory. Use the workspace_* tools with relative paths for workspace files. Your reviewed role instructions and skills are already injected from the immutable runtime profile; do not search for them in the workspace or claim they are unavailable because AGENTS.md or .agents/skills is absent. The tools registered for this run are authoritative: use a listed tool when its description and injected skill apply, and report a capability as unavailable only when it is not listed.";

const HOST_RUNTIME_SYSTEM_PROMPT =
  "The Jarvis workspace is the current working directory. Use the workspace_* tools with relative paths for all workspace files. AGENTS.md and .agents/skills are read-only: never modify them. To follow an available skill, use workspace_read on its relative .agents/skills/<skill-name>/SKILL.md path.";

const ATTACHMENT_INSTRUCTIONS =
  "If the user explicitly asks to retain an attachment, use attachment_save and link its returned path from the canonical note. If the user asks for a file to be returned, write only the finished artifact to .outbox/";

/** Pure construction of the prompts supplied to a Pi agent session. */
export class PiPromptAssembler {
  appendSystemPrompt(profileRuntime: boolean, now: Date, userTimezone?: string): string[] {
    return [
      profileRuntime ? PROFILE_RUNTIME_SYSTEM_PROMPT : HOST_RUNTIME_SYSTEM_PROMPT,
      currentTimeContext(now, userTimezone)
    ];
  }

  userPrompt(inputText: string, extractedDocumentText: string | undefined, runId: string): string {
    const content = [inputText, extractedDocumentText].filter(Boolean).join("\n\n");
    return `${content}\n\n${ATTACHMENT_INSTRUCTIONS}${runId}/.`;
  }
}
