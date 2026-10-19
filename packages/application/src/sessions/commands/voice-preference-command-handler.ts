import type { InboundMessageV1 } from "@second-brain/contracts";

import type { ConversationPreferencePort } from "../../ports.js";

type VoicePreferenceStore = Pick<ConversationPreferencePort, "getVoiceReplies" | "setVoiceReplies">;

export interface VoicePreferenceCommandResult {
  enabled: boolean;
  text: string;
}

/** Handles voice-reply preference lookup and mutation for a conversation or thread. */
export class VoicePreferenceCommandHandler {
  constructor(private readonly preferences: VoicePreferenceStore | undefined) {}

  async handle(
    message: InboundMessageV1,
    enabled: boolean | undefined
  ): Promise<VoicePreferenceCommandResult> {
    if (!this.preferences) {
      throw new Error("Voice preferences are not configured.");
    }
    const input = {
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      conversationId: message.conversationId,
      ...(message.threadRootExternalEventId
        ? { threadRootExternalEventId: message.threadRootExternalEventId }
        : {})
    };
    const value =
      enabled === undefined
        ? await this.preferences.getVoiceReplies(input)
        : await this.preferences.setVoiceReplies({ ...input, enabled });

    if (enabled !== undefined && !message.threadRootExternalEventId) {
      await this.preferences.setVoiceReplies({
        ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
        conversationId: message.conversationId,
        threadRootExternalEventId: message.externalEventId,
        enabled
      });
    }

    return {
      enabled: value,
      text: `Voice replies: ${value ? "on" : "off"}. Voice notes get an English audio reply when available; otherwise, the reply is text.`
    };
  }
}
