import type { z } from "zod";

export type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export interface InternalApiRoute {
  readonly method: HttpMethod;
  readonly path: string;
  readonly operationId: string;
  readonly summary: string;
  readonly description?: string;
  readonly pathParam?: string;
  readonly requestSchema?: z.ZodTypeAny;
  readonly requestRequired?: boolean;
  readonly responses: Readonly<Record<string, ResponseDescriptor>>;
}

export interface ResponseDescriptor {
  readonly description: string;
  readonly schema?: z.ZodTypeAny;
  /**
   * Array schema: wraps `schema` in `{ type: "array", items: { $ref } }`.
   */
  readonly arrayOf?: z.ZodTypeAny;
}
