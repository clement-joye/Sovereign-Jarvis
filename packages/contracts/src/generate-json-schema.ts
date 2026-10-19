import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { zodToJsonSchema } from "zod-to-json-schema";
import type { z } from "zod";

import { InternalApiRoutes } from "./internal-api-routes.js";
import { ContractSchemas } from "./schemas.js";

const currentDir = dirname(fileURLToPath(import.meta.url));
const docsGeneratedDir = join(currentDir, "..", "..", "..", "docs", "generated");
const schemaOutDir = join(docsGeneratedDir, "schemas");
const openApiOutDir = join(docsGeneratedDir, "openapi");

mkdirSync(schemaOutDir, { recursive: true });
mkdirSync(openApiOutDir, { recursive: true });

const components: Record<string, unknown> = {};
const schemaNameByReference = new WeakMap<z.ZodTypeAny, string>();

for (const [name, schema] of Object.entries(ContractSchemas)) {
  const jsonSchema = zodToJsonSchema(schema, name);
  writeFileSync(
    join(schemaOutDir, `${name}.schema.json`),
    `${JSON.stringify(jsonSchema, null, 2)}\n`
  );
  components[name] = jsonSchema;
  schemaNameByReference.set(schema, name);
}

function schemaRef(schema: z.ZodTypeAny): string {
  const name = schemaNameByReference.get(schema) ?? "Unknown";
  return `#/components/schemas/${name}`;
}

const paths: Record<string, Record<string, unknown>> = {};

for (const route of InternalApiRoutes) {
  const operation: Record<string, unknown> = {
    summary: route.summary,
    operationId: route.operationId,
    responses: Object.fromEntries(
      Object.entries(route.responses).map(([status, descriptor]) => {
        const response: Record<string, unknown> = { description: descriptor.description };
        if (descriptor.schema !== undefined) {
          response.content = {
            "application/json": { schema: { $ref: schemaRef(descriptor.schema) } }
          };
        }
        if (descriptor.arrayOf !== undefined) {
          response.content = {
            "application/json": {
              schema: {
                type: "array",
                items: { $ref: schemaRef(descriptor.arrayOf) }
              }
            }
          };
        }
        return [status, response];
      })
    )
  };
  if (route.description !== undefined) {
    operation.description = route.description;
  }
  if (route.pathParam !== undefined) {
    operation.parameters = [
      {
        name: route.pathParam,
        in: "path",
        required: true,
        schema: { type: "string" }
      }
    ];
  }
  if (route.requestSchema !== undefined) {
    operation.requestBody = {
      required: route.requestRequired ?? true,
      content: {
        "application/json": {
          schema: { $ref: schemaRef(route.requestSchema) }
        }
      }
    };
  }
  const pathItem = paths[route.path] ?? {};
  pathItem[route.method.toLowerCase()] = operation;
  paths[route.path] = pathItem;
}

const openApi = {
  openapi: "3.1.0",
  info: {
    title: "Second Brain Internal API",
    version: "0.0.0"
  },
  paths,
  components: {
    schemas: components
  }
};

writeFileSync(join(openApiOutDir, "internal-api.v1.json"), `${JSON.stringify(openApi, null, 2)}\n`);
