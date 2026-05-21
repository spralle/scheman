import type { JsonSchema } from "./adapters/json-schema-types.js";

/** A synchronous transform applied to a JSON Schema before extraction */
export type SchemaMiddleware = (schema: JsonSchema) => JsonSchema;

/** Compose N middleware functions left-to-right over a schema */
export function applySchemaMiddleware(schema: JsonSchema, fns: readonly SchemaMiddleware[]): JsonSchema {
  return fns.reduce<JsonSchema>((s, fn) => fn(s), schema);
}
