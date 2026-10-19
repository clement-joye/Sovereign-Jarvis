import type { AttachmentStorePort } from "@second-brain/application";

export class InMemoryAttachmentStore implements AttachmentStorePort {
  async delete(): Promise<void> {
    return undefined;
  }

  async put(): Promise<never> {
    throw new Error("Attachment writes are not implemented in the in-memory control plane.");
  }

  async open(): Promise<never> {
    throw new Error("Attachment reads are not implemented in the in-memory control plane.");
  }

  async stat(): Promise<undefined> {
    return undefined;
  }

  async listOrphans(): Promise<string[]> {
    return [];
  }
}
