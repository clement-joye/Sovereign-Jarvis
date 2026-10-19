import type { PiRunResultV1 } from "@second-brain/contracts";

/**
 * Sentinel token the model is instructed to emit when a scheduled run has
 * nothing meaningful to report. The exact-match silence detector below
 * treats this token alone (after trim) as "no notification".
 *
 * The token is intentionally bracketed and unusual so it is unlikely to
 * collide with natural text in a schedule's instruction. If you ever
 * change it, update both sides of this module atomically.
 */
export const SCHEDULE_SILENCE_TOKEN = "<NO_REPLY>";

const SCHEDULE_SILENCE_PROTOCOL_INSTRUCTION = [
  "---",
  "SILENCE PROTOCOL:",
  `If, according to the user's instructions, you should remain silent for this run, reply with EXACTLY the token ${SCHEDULE_SILENCE_TOKEN} and nothing else. Otherwise, respond normally.`,
  "Otherwise, respond normally."
].join("\n");

export function buildScheduleInputText(scheduleInstruction: string): string {
  const trimmed = scheduleInstruction.trim();
  if (!trimmed) {
    return SCHEDULE_SILENCE_PROTOCOL_INSTRUCTION;
  }
  return `${trimmed}\n\n${SCHEDULE_SILENCE_PROTOCOL_INSTRUCTION}`;
}

export function isScheduledSilenceResponse(
  result: Pick<PiRunResultV1, "status" | "text">
): boolean {
  if (result.status !== "completed") {
    return false;
  }
  const trimmed = result.text?.trim() ?? "";
  if (!trimmed) {
    return true;
  }
  return trimmed === SCHEDULE_SILENCE_TOKEN;
}
