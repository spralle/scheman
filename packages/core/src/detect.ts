import type { StandardSchemaV1 } from "./types.js";

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
  return (
    typeof value === "object" &&
    value !== null &&
    "~standard" in value &&
    typeof (value as Record<string, unknown>)["~standard"] === "object"
  );
}

export function isZodSchema(schema: StandardSchemaV1): boolean {
  return schema["~standard"].vendor === "zod";
}

/**
 * Distinguishes Zod v4 from v3. v4 schemas lack `_def.typeName` and expose
 * a `_zod` property with introspection data instead.
 */
export function isZodV4Schema(schema: unknown): boolean {
  if (typeof schema !== "object" || schema === null) return false;
  const rec = schema as Record<string, unknown>;

  // v4 schemas have a `_zod` property with `def` and `traits`
  if (typeof rec["_zod"] === "object" && rec["_zod"] !== null) return true;

  // v3 schemas have `_def.typeName` — if present, it's v3
  const def = rec["_def"] as Record<string, unknown> | undefined;
  if (def && typeof def["typeName"] === "string") return false;

  // Fallback: if it's a Standard Schema with vendor 'zod' but no _def.typeName, treat as v4
  if (isStandardSchema(schema) && isZodSchema(schema) && !def?.["typeName"]) return true;

  return false;
}
