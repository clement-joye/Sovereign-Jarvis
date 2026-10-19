import { z } from "zod";

import { Identifier, PositiveBoundedInteger } from "./primitives.js";
import { TokenBudgetSchema } from "../../token-budget.js";

export const RuntimeClassPinV2Schema = z
  .object({
    id: Identifier,
    image: z.string().regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/),
    mountPolicy: z.enum(["none", "read-only", "scoped-write", "read-write"]),
    networkPolicy: z.enum(["none", "restricted", "browser-restricted"]),
    featureIds: z.array(Identifier).max(64),
    resourceCeiling: z
      .object({
        timeoutSeconds: PositiveBoundedInteger(3_600),
        tokenBudget: TokenBudgetSchema,
        maxConcurrentRuns: PositiveBoundedInteger(32),
        memoryMiB: PositiveBoundedInteger(65_536),
        cpuMillicores: PositiveBoundedInteger(64_000),
        pids: PositiveBoundedInteger(4_096),
        maxOutputBytes: PositiveBoundedInteger(10_000_000)
      })
      .strict()
  })
  .strict();
export type RuntimeClassPinV2 = z.infer<typeof RuntimeClassPinV2Schema>;
