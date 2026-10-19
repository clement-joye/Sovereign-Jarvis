import type { InboundMessageV1, ThreadContextPolicyV1 } from "@second-brain/contracts";
import type { AgentCatalog } from "@second-brain/domain";

export interface ThreadContextBudget {
  historyLimit: number;
  maxCharsPerItem: number;
  maxTotalChars: number;
}

export const REUSED_SESSION_THREAD_CONTEXT: ThreadContextBudget = {
  historyLimit: 12,
  maxCharsPerItem: 600,
  maxTotalChars: 7_200
};

export const FRESH_SESSION_THREAD_CONTEXT: ThreadContextBudget = {
  historyLimit: 100,
  maxCharsPerItem: 1_200,
  maxTotalChars: 32_000
};

/** Agents default to clean turns unless their reviewed catalog policy retains session state. */
export function threadContextPolicyForAgent(
  catalog: AgentCatalog,
  agentId: string | undefined
): ThreadContextPolicyV1 {
  return (
    catalog.require(agentId ?? catalog.defaultAgentId()).threadContextPolicy ??
    "fresh_session_with_thread_history"
  );
}

export function threadContextBudget(policy: ThreadContextPolicyV1): ThreadContextBudget {
  return policy === "reuse_session" ? REUSED_SESSION_THREAD_CONTEXT : FRESH_SESSION_THREAD_CONTEXT;
}

/** A stable per-message identity makes retries idempotent without resuming earlier thread turns. */
export function piSessionForInboundTurn(
  message: InboundMessageV1,
  routedSessionId: string,
  policy: ThreadContextPolicyV1
): { sessionId: string; persistence: "persistent" | "ephemeral" } {
  if (policy === "reuse_session") {
    return { sessionId: routedSessionId, persistence: "persistent" };
  }
  return { sessionId: `turn-${message.id}`, persistence: "ephemeral" };
}
