import type { JsonSchema } from "./json-schema-types.js";

const KNOWN_JSON_SCHEMA_TYPES = new Set(["string", "number", "integer", "boolean", "object", "array", "null"]);

/** Detect if an unknown value looks like a JSON Schema object */
export function isJsonSchema(value: unknown): value is JsonSchema {
	if (typeof value !== "object" || value === null) return false;
	const obj = value as Record<string, unknown>;

	if ("$schema" in obj) return true;
	if ("properties" in obj && typeof obj.properties === "object") return true;
	if ("items" in obj && typeof obj.items === "object") return true;
	if ("enum" in obj && Array.isArray(obj.enum)) return true;
	if ("type" in obj && typeof obj.type === "string" && KNOWN_JSON_SCHEMA_TYPES.has(obj.type)) return true;
	if ("type" in obj && Array.isArray(obj.type)) return true;

	return false;
}
