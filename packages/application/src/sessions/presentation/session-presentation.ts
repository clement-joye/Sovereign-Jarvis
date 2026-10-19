import type { SessionRecord } from "@second-brain/domain";

export function formatSessionList(sessions: SessionRecord[]): string {
  if (sessions.length === 0) {
    return "No recent sessions. Send a message or use `/new` to start one.";
  }

  return [
    `Recent sessions (${sessions.length}):`,
    ...sessions.map(
      (session, index) =>
        `${index + 1}. ${displayLabel(session)} · ${formatStatus(session.status)} · Last activity ${formatTimestamp(session.lastActiveAt)}`
    )
  ].join("\n");
}

export function displayLabel(session: SessionRecord): string {
  return session.label?.trim() || "Untitled conversation";
}

export function formatStatus(status: SessionRecord["status"]): string {
  return status.charAt(0).toUpperCase() + status.slice(1).replace(/-/g, " ");
}

export function formatTimestamp(timestamp: Date): string {
  return timestamp
    .toISOString()
    .replace("T", " ")
    .replace(/\.\d{3}Z$/, " UTC");
}

export function normalizeSessionLabel(text: string | undefined): string | undefined {
  const normalized = text?.replace(/\s+/g, " ").trim();
  if (!normalized) return undefined;
  const words = normalized.split(" ").slice(0, 8).join(" ");
  return words.length === normalized.length ? words : `${words}…`;
}
