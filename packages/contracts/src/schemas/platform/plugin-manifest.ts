import { z } from "zod";

import { AgentContributionV2Schema } from "./agent-contribution.js";
import {
  BrokerProviderV2Schema,
  LocalToolProviderV2Schema,
  RuntimeFeatureV2Schema
} from "./capabilities.js";
import { Identifier, SchemaVersionV2 } from "./primitives.js";

/** A plugin source manifest. Runtime installation is performed from an immutable compiled release. */
export const PluginManifestV2Schema = z
  .object({
    schemaVersion: SchemaVersionV2,
    id: Identifier,
    displayName: z.string().min(1).max(120),
    /** Built-ins are always active; workspace plugins require an explicit binding. */
    activation: z.enum(["built-in", "workspace"]).default("workspace"),
    agents: z.array(AgentContributionV2Schema).max(64),
    localToolProviders: z.array(LocalToolProviderV2Schema).max(64),
    brokerProviders: z.array(BrokerProviderV2Schema).max(64),
    runtimeFeatures: z.array(RuntimeFeatureV2Schema).max(64)
  })
  .strict()
  .superRefine((value, ctx) => {
    const contributionCount =
      value.agents.length +
      value.localToolProviders.length +
      value.brokerProviders.length +
      value.runtimeFeatures.length;
    if (contributionCount === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message:
          "A plugin manifest must contribute at least one agent, provider, or runtime feature."
      });
    }
    const checkUnique = (ids: string[], path: string) => {
      const seen = new Set<string>();
      for (const id of ids) {
        if (seen.has(id)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: [path],
            message: `Duplicate ${path} id: ${id}.`
          });
        }
        seen.add(id);
      }
    };
    checkUnique(
      value.agents.map((agent) => agent.id),
      "agents"
    );
    checkUnique(
      value.localToolProviders.map((provider) => provider.id),
      "localToolProviders"
    );
    checkUnique(
      value.brokerProviders.map((provider) => provider.id),
      "brokerProviders"
    );
    checkUnique(
      value.runtimeFeatures.map((feature) => feature.id),
      "runtimeFeatures"
    );
  });
export type PluginManifestV2 = z.infer<typeof PluginManifestV2Schema>;
