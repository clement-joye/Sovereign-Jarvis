import {
  validateReviewedRuntimeSpecification,
  type ReviewedRuntimeSpecification
} from "./runtime-provisioner-policy.js";

export interface RuntimeTemplateEntry {
  templateId: string;
  templateVersion: string;
  specification: ReviewedRuntimeSpecification;
}

/** Immutable allowlist used by the privileged provisioner. */
export class RuntimeTemplateCatalog {
  private readonly entries = new Map<string, RuntimeTemplateEntry>();
  constructor(entries: readonly RuntimeTemplateEntry[]) {
    for (const entry of entries) {
      const key = `${entry.templateId}@${entry.templateVersion}`;
      if (this.entries.has(key)) throw new Error(`Duplicate runtime template: ${key}`);
      this.entries.set(key, {
        ...entry,
        specification: validateReviewedRuntimeSpecification(entry.specification)
      });
    }
  }
  get(templateId: string, templateVersion: string): RuntimeTemplateEntry | undefined {
    return this.entries.get(`${templateId}@${templateVersion}`);
  }
}
