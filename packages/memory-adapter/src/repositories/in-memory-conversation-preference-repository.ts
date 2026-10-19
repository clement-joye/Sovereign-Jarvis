import type { ConversationPreferencePort } from "@second-brain/application";

export class InMemoryConversationPreferenceRepository implements ConversationPreferencePort {
  private readonly values = new Map<string, boolean>();
  private readonly sessionContexts = new Map<
    string,
    { mode?: "persistent"; historyLimit?: number }
  >();

  async getVoiceReplies(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<boolean> {
    return this.values.get(this.key(input)) ?? false;
  }

  async setVoiceReplies(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
    enabled: boolean;
  }): Promise<boolean> {
    this.values.set(this.key(input), input.enabled);
    return input.enabled;
  }

  async getSessionContext(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
  }): Promise<{ mode?: "persistent"; historyLimit?: number }> {
    return this.sessionContexts.get(this.key(input)) ?? {};
  }

  async setSessionContext(input: {
    conversationId: string;
    threadRootExternalEventId?: string;
    mode?: "persistent";
    historyLimit?: number;
  }): Promise<{ mode?: "persistent"; historyLimit?: number }> {
    const value = {
      ...(input.mode ? { mode: input.mode } : {}),
      ...(input.historyLimit !== undefined ? { historyLimit: input.historyLimit } : {})
    };
    this.sessionContexts.set(this.key(input), value);
    return value;
  }

  private key(input: {
    workspaceId?: string;
    conversationId: string;
    threadRootExternalEventId?: string;
  }): string {
    return `${input.workspaceId ?? ""}\u0000${input.conversationId}\u0000${input.threadRootExternalEventId ?? ""}`;
  }
}
