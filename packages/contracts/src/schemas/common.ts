import { z } from "zod";

export const SchemaVersionV1 = z.literal(1);

export const NonEmptyString = z.string().min(1);
export const IsoTimestamp = z.string().min(1);
export const OpaqueId = z.string().min(1);

export const TemplateIdentifier = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export const TemplateVersion = z.string().regex(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/);
export const Sha256Digest = z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const AgentIdV1Schema = z.string().regex(/^[a-z][a-z0-9-]{0,63}$/);
export type AgentIdV1 = z.infer<typeof AgentIdV1Schema>;
export const RelativeResourcePath = z
  .string()
  .min(1)
  .refine(
    (value) =>
      !value.startsWith("/") &&
      !value.split("/").some((segment) => segment === ".." || segment.length === 0),
    "Template resource paths must be non-empty relative paths without traversal."
  );
export const AgentToolIdentifier = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/);
export const PositiveBoundedInteger = (maximum: number) => z.number().int().positive().max(maximum);
