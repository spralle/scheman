import type { JsonSchema } from "./json-schema-types.js";

/**
 * Dereference all local $ref pointers in a JSON Schema by inlining definitions.
 * Only supports local references (#/$defs/... and #/definitions/...).
 * Throws on circular references or unresolvable $ref.
 */
export function dereferenceSchema(schema: JsonSchema): JsonSchema {
  const defs = resolveDefs(schema);
  return derefNode(schema, defs, new Set<string>());
}

function resolveDefs(root: JsonSchema): Readonly<Record<string, JsonSchema>> {
  return { ...root.definitions, ...root.$defs };
}

function derefNode(node: JsonSchema, defs: Readonly<Record<string, JsonSchema>>, visiting: Set<string>): JsonSchema {
  if (node.$ref) {
    return resolveRef(node.$ref, defs, visiting);
  }
  return derefProperties(node, defs, visiting);
}

function resolveRef(ref: string, defs: Readonly<Record<string, JsonSchema>>, visiting: Set<string>): JsonSchema {
  const name = parseLocalRef(ref);
  if (visiting.has(name)) {
    throw new Error(`Circular $ref detected: ${ref}`);
  }

  const target = defs[name];
  if (!target) {
    throw new Error(`Unresolvable $ref: ${ref}`);
  }

  visiting.add(name);
  const resolved = derefNode(target, defs, visiting);
  visiting.delete(name);
  return resolved;
}

function parseLocalRef(ref: string): string {
  const match = /^#\/(?:\$defs|definitions)\/(.+)$/.exec(ref);
  if (!match) {
    throw new Error(`Unsupported $ref format: ${ref}. Only local #/$defs/ and #/definitions/ refs are supported.`);
  }
  return match[1];
}

function derefProperties(
  node: JsonSchema,
  defs: Readonly<Record<string, JsonSchema>>,
  visiting: Set<string>,
): JsonSchema {
  const result: Record<string, unknown> = { ...node };

  if (node.properties) {
    result.properties = mapRecord(node.properties, (v) => derefNode(v, defs, visiting));
  }
  if (node.items) {
    result.items = derefNode(node.items, defs, visiting);
  }
  if (node.if) result.if = derefNode(node.if, defs, visiting);
  // biome-ignore lint/suspicious/noThenProperty: JSON Schema if/then/else keyword
  if (node.then) result.then = derefNode(node.then, defs, visiting);
  if (node.else) result.else = derefNode(node.else, defs, visiting);
  if (node.oneOf) result.oneOf = node.oneOf.map((s) => derefNode(s, defs, visiting));
  if (node.anyOf) result.anyOf = node.anyOf.map((s) => derefNode(s, defs, visiting));
  if (node.allOf) result.allOf = node.allOf.map((s) => derefNode(s, defs, visiting));

  // Strip $defs/definitions from output — already inlined
  delete result.$defs;
  delete result.definitions;

  return result as JsonSchema;
}

function mapRecord(
  rec: Readonly<Record<string, JsonSchema>>,
  fn: (v: JsonSchema) => JsonSchema,
): Record<string, JsonSchema> {
  const out: Record<string, JsonSchema> = {};
  for (const [k, v] of Object.entries(rec)) {
    out[k] = fn(v);
  }
  return out;
}
