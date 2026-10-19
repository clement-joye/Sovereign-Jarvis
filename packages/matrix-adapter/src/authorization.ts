export interface MatrixAuthorizationConfig {
  ownerMatrixId: string;
  brainUserId: string;
}

export interface MatrixEventEnvelope {
  room_id?: unknown;
  sender?: unknown;
  type?: unknown;
  event_id?: unknown;
}

export type MatrixAuthorizationDecision =
  | { authorized: true }
  | {
      authorized: false;
      reason: "wrong_sender" | "self_message" | "unsupported_event";
    };

export function authorizeMatrixEvent(
  event: MatrixEventEnvelope,
  config: MatrixAuthorizationConfig
): MatrixAuthorizationDecision {
  if (event.type !== "m.room.message") {
    return { authorized: false, reason: "unsupported_event" };
  }
  if (event.sender === config.brainUserId) {
    return { authorized: false, reason: "self_message" };
  }
  if (event.sender !== config.ownerMatrixId) {
    return { authorized: false, reason: "wrong_sender" };
  }
  return { authorized: true };
}
