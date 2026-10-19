import type { SessionResolutionV1 } from "@second-brain/contracts";
import type { CommandDecision } from "@second-brain/domain";

export type SessionRoutingResult =
  | { kind: "send-to-pi"; resolution: SessionResolutionV1 }
  | {
      kind: "command-response";
      command: CommandDecision["type"];
      text: string;
      presentation?: "notice" | "error";
      sessionId?: string;
    };
