import type { JsonSchema } from "./json-schema-types.js";

/** Detect if an unknown value looks like a JSON Schema object */
export function isJsonSchema(value: unknown): value is JsonSchema {
  if (typeof value !== "object" || value === null) return false;
  const obj = value as Record<string, unknown>;

  const hasSchemaMarker = "$schema" in obj;
  const hasProperties = "properties" in obj && typeof obj["properties"] === "object";
  const hasItems = "items" in obj && typeof obj["items"] === "object";
  const hasEnum = "enum" in obj && Array.isArray(obj["enum"]);
  const hasType = "type" in obj && (typeof obj["type"] === "string" || Array.isArray(obj["type"]));

  if (hasSchemaMarker) return true;
  if (hasProperties) return true;
  if (hasItems) return true;
  if (hasEnum) return true;
  if (hasType && typeof obj["type"] === "string") {
    const knownTypes = ["string", "number", "integer", "boolean", "object", "array", "null"];
    if (knownTypes.includes(obj["type"] as string)) return true;
  }
  if (hasType && Array.isArray(obj["type"])) return true;

  return false;
}
