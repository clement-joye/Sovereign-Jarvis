import { z } from "zod";
import { NonEmptyString, SchemaVersionV1 } from "./common.js";

export const StructuredErrorV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  code: NonEmptyString,
  category: z.enum([
    "validation",
    "authorization",
    "dependency",
    "timeout",
    "conflict",
    "internal"
  ]),
  message: NonEmptyString,
  retryable: z.boolean(),
  details: z.record(z.unknown()).optional()
});
export type StructuredErrorV1 = z.infer<typeof StructuredErrorV1Schema>;
