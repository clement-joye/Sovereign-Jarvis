import type { InboundMessageV1, PiRunResultV1 } from "@second-brain/contracts";

import type { OutboundResponseInput } from "../../outbound/outbound-response-factory.js";
import {
  generatedFiles,
  generatedImages,
  piResultText
} from "../../outbound/pi-result-presentation.js";
import type { ConversationPreferencePort, MediaProcessorPort } from "../../ports.js";

/** Shapes the user-facing response for a completed interactive Pi run. */
export class InboundPiResponseFactory {
  constructor(
    private readonly media: MediaProcessorPort,
    private readonly preferences: ConversationPreferencePort | undefined
  ) {}

  async create(input: {
    message: InboundMessageV1;
    outboundKey: string;
    result: PiRunResultV1;
  }): Promise<OutboundResponseInput> {
    const { message, outboundKey, result } = input;
    const rawText = piResultText(result);
    const agentLabel = presentAgentLabel(message.agentId);
    const text = agentLabel ? `${agentLabel}\n\n${rawText}` : rawText;
    const threadRootExternalEventId = replyThreadRoot(message);

    if (await this.voiceRepliesEnabled(message)) {
      try {
        const audio = await this.media.synthesizeAudio(rawText);
        return {
          idempotencyKey: outboundKey,
          traceId: message.traceId,
          conversationId: message.conversationId,
          ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
          // Keep the textual agent marker visible beside a voice response.
          // The spoken content stays natural and does not announce the label.
          ...(agentLabel ? { text: agentLabel } : {}),
          audio,
          replyToExternalEventId: threadRootExternalEventId,
          threadRootExternalEventId
        };
      } catch {
        // TTS is an enhancement. Preserve a useful text response if it is
        // temporarily unavailable instead of failing the entire interaction.
      }
    }

    return {
      idempotencyKey: outboundKey,
      traceId: message.traceId,
      conversationId: message.conversationId,
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      text,
      images: generatedImages(result),
      files: generatedFiles(result),
      replyToExternalEventId: threadRootExternalEventId,
      threadRootExternalEventId
    };
  }

  private async voiceRepliesEnabled(message: InboundMessageV1): Promise<boolean> {
    if (!message.attachments.some((attachment) => attachment.mediaType.startsWith("audio/"))) {
      return false;
    }
    if (!this.preferences) return false;
    return this.preferences.getVoiceReplies({
      ...(message.workspaceId ? { workspaceId: message.workspaceId } : {}),
      conversationId: message.conversationId,
      ...(message.threadRootExternalEventId
        ? { threadRootExternalEventId: message.threadRootExternalEventId }
        : {})
    });
  }
}

function presentAgentLabel(agentId: InboundMessageV1["agentId"]): string | undefined {
  return agentId ? `**${agentId}**:` : undefined;
}

function replyThreadRoot(message: InboundMessageV1): string {
  return message.threadRootExternalEventId ?? message.externalEventId;
}
