import { z } from "zod";
import { IsoTimestamp, NonEmptyString, SchemaVersionV1 } from "./common.js";

/** Compatibility identity for the current internal HTTP contract family. */
export const INTERNAL_API_VERSION = "1";

export const HealthStatusV1Schema = z.object({
  schemaVersion: SchemaVersionV1,
  service: NonEmptyString,
  status: z.enum(["live", "ready", "degraded", "unavailable"]),
  checkedAt: IsoTimestamp,
  version: NonEmptyString,
  apiVersion: NonEmptyString.optional(),
  catalogDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  policyDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  resourceDigest: z
    .string()
    .regex(/^sha256:[a-f0-9]{64}$/)
    .optional(),
  runtimeImageId: z
    .string()
    .regex(/^(?:[a-z0-9][a-z0-9./_-]*@sha256:[a-f0-9]{64}|sha256:[a-f0-9]{64})$/)
    .optional(),
  dependencies: z
    .array(
      z.object({
        name: NonEmptyString,
        status: z.enum(["ready", "degraded", "unavailable"]),
        failureKind: z
          .enum(["api_incompatible", "policy_mismatch", "dependency_unavailable"])
          .optional(),
        detail: z.string().optional()
      })
    )
    .default([])
});
export type HealthStatusV1 = z.infer<typeof HealthStatusV1Schema>;
