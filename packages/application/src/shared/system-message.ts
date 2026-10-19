export type SystemMessageCategory =
  | "AGENTS"
  | "APPROVAL"
  | "APPROVAL REQUIRED"
  | "ERROR"
  | "HELP"
  | "PLUGINS"
  | "PREFERENCES"
  | "SCHEDULES"
  | "SESSIONS"
  | "WORKSPACE";

/** Adds a client-independent plain-text banner to platform-authored Matrix messages. */
export function formatSystemMessage(category: SystemMessageCategory, body: string): string {
  const banner = `━━ JARVIS · ${category} ━━`;
  const content = body.trim();
  return content ? `${banner}\n\n${content}` : banner;
}
