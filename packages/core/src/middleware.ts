import type { JsonSchema } from "./providers/json-schema/index.js";

/** A caller-trusted synchronous transform, including boolean JSON Schemas. */
export type SchemaMiddleware = (schema: JsonSchema) => JsonSchema;

/** Compose N middleware functions left-to-right over a schema */
export function applySchemaMiddleware(schema: JsonSchema, fns: readonly SchemaMiddleware[]): JsonSchema {
	return fns.reduce<JsonSchema>((s, fn) => fn(s), schema);
}
