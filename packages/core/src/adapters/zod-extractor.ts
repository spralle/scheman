import { SchemaError } from "../errors.js";
import type {
  SchemaFieldInfo,
  SchemaFieldMetadata,
  SchemaFieldType,
  SchemaIngestionResult,
  SchemaMetadata,
} from "../types.js";

// Zod internal types for duck-typed traversal (Zod has no formal traversal API)
interface ZodTypeDef {
  readonly typeName?: string;
  readonly description?: string;
  readonly checks?: readonly unknown[];
}

interface ZodLike {
  readonly _def?: ZodTypeDef & Record<string, unknown>;
  readonly _type?: string;
}

export function extractFromZod(schema: unknown): SchemaIngestionResult {
  const zodSchema = schema as ZodLike;
  if (!zodSchema._def) {
    throw new SchemaError("SCHEMA_PARSE_FAILED", "Schema does not appear to be a Zod schema");
  }

  const fields: SchemaFieldInfo[] = [];

  const rootMeta = extractFormbarMetadata(zodSchema);
  const metadata: SchemaMetadata = {
    vendor: "zod",
    ...(rootMeta ? { extra: rootMeta as unknown as Readonly<Record<string, unknown>> } : {}),
  };

  walkZodSchema(zodSchema, "", fields, true);

  return { fields, metadata };
}

interface WalkContext {
  nullable?: boolean;
  readOnly?: boolean;
  defaultValue?: unknown;
}

function walkZodSchema(
  schema: ZodLike,
  prefix: string,
  fields: SchemaFieldInfo[],
  required: boolean,
  ctx: WalkContext = {},
): void {
  const def = schema._def;
  if (!def) return;

  const typeName = def.typeName ?? "";

  if (typeName === "ZodOptional") {
    const inner = def["innerType"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, false);
    }
    return;
  }

  if (typeName === "ZodNullable") {
    const inner = def["innerType"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, required, { ...ctx, nullable: true });
    }
    return;
  }

  if (typeName === "ZodDefault") {
    const inner = def["innerType"] as ZodLike | undefined;
    const defaultValue =
      typeof def["defaultValue"] === "function" ? (def["defaultValue"] as () => unknown)() : undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, false, { defaultValue });
    }
    return;
  }

  if (typeName === "ZodEffects") {
    const inner = def["schema"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, required);
    }
    return;
  }

  if (typeName === "ZodPipeline") {
    const inner = def["in"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, required);
    }
    return;
  }

  if (typeName === "ZodLazy") {
    const getter = def["getter"] as (() => ZodLike) | undefined;
    if (getter) {
      walkZodSchema(getter(), prefix, fields, required);
    }
    return;
  }

  if (typeName === "ZodBranded") {
    const inner = def["type"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, required);
    }
    return;
  }

  if (typeName === "ZodCatch") {
    const inner = def["innerType"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, required);
    }
    return;
  }

  if (typeName === "ZodReadonly") {
    const inner = def["innerType"] as ZodLike | undefined;
    if (inner) {
      walkZodSchema(inner, prefix, fields, required, { ...ctx, readOnly: true });
    }
    return;
  }

  if (typeName === "ZodObject") {
    const shape = def["shape"] as Record<string, ZodLike> | (() => Record<string, ZodLike>) | undefined;
    const resolvedShape = typeof shape === "function" ? shape() : shape;
    if (resolvedShape) {
      for (const [key, value] of Object.entries(resolvedShape)) {
        const childPath = prefix ? `${prefix}.${key}` : key;
        walkZodSchema(value, childPath, fields, true);
      }
    }
    return;
  }

  if (typeName === "ZodArray") {
    const metadata = mergeZodMetadata(schema, ctx);
    fields.push({
      path: prefix,
      type: "array",
      required,
      ...(ctx.defaultValue !== undefined ? { defaultValue: ctx.defaultValue } : {}),
      ...(metadata ? { metadata } : {}),
    });
    return;
  }

  if (typeName === "ZodLiteral") {
    const value = def["value"];
    const literalType = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
    const metadata = mergeZodMetadata(schema, ctx, { const: value });
    if (prefix) {
      fields.push({ path: prefix, type: literalType as SchemaFieldType, required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (typeName === "ZodNativeEnum") {
    const values = def["values"] as Record<string, unknown> | undefined;
    const enumValues = values ? Object.values(values) : [];
    const metadata = mergeZodMetadata(schema, ctx, { enum: enumValues });
    if (prefix) {
      fields.push({ path: prefix, type: "enum", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (typeName === "ZodIntersection") {
    const left = def["left"] as ZodLike | undefined;
    const right = def["right"] as ZodLike | undefined;
    if (left) walkZodSchema(left, prefix, fields, required, ctx);
    if (right) walkZodSchema(right, prefix, fields, required, ctx);
    return;
  }

  if (typeName === "ZodRecord") {
    const metadata = mergeZodMetadata(schema, ctx, { additionalProperties: true });
    if (prefix) {
      fields.push({ path: prefix, type: "object", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (typeName === "ZodTuple") {
    const items = def["items"] as readonly ZodLike[] | undefined;
    const metadata = mergeZodMetadata(schema, ctx, { tuple: true, itemCount: items?.length ?? 0 });
    if (prefix) {
      fields.push({ path: prefix, type: "array", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (typeName === "ZodBigInt") {
    const metadata = mergeZodMetadata(schema, ctx);
    if (prefix) {
      fields.push({ path: prefix, type: "integer", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  const fieldType = mapZodType(typeName);
  const metadata = mergeZodMetadata(schema, ctx);

  if (prefix) {
    fields.push({
      path: prefix,
      type: fieldType,
      required,
      ...(ctx.defaultValue !== undefined ? { defaultValue: ctx.defaultValue } : {}),
      ...(metadata ? { metadata } : {}),
    });
  }
}

function mapZodType(typeName: string): SchemaFieldType {
  switch (typeName) {
    case "ZodString":
      return "string";
    case "ZodNumber":
      return "number";
    case "ZodBoolean":
      return "boolean";
    case "ZodDate":
      return "date";
    case "ZodEnum":
      return "enum";
    case "ZodUnion":
    case "ZodDiscriminatedUnion":
      return "union";
    case "ZodArray":
      return "array";
    case "ZodObject":
      return "object";
    default:
      return "unknown";
  }
}

const KNOWN_META_KEYS = new Set([
  "title",
  "description",
  "enum",
  "default",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "format",
  "pattern",
  "widget",
  "options",
  "label",
  "placeholder",
]);

function extractFormbarMetadata(schema: ZodLike): SchemaFieldMetadata | undefined {
  const def = schema._def;
  if (!def) return undefined;

  const rawMeta = def["metadata"] as Record<string, unknown> | undefined;
  if (rawMeta && "x-formbar" in rawMeta) {
    throw new SchemaError(
      "SCHEMA_ZOD_TRANSFORM_FORBIDDEN",
      "x-formbar is not allowed in Zod metadata. Use .meta({ formbar: { ... } }) instead.",
    );
  }

  if (rawMeta && typeof rawMeta === "object" && "formbar" in rawMeta) {
    const formbar = rawMeta["formbar"] as Record<string, unknown>;
    const result: Record<string, unknown> = {};
    const extra: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(formbar)) {
      if (KNOWN_META_KEYS.has(key)) {
        result[key] = value;
      } else {
        extra[key] = value;
      }
    }

    if (Object.keys(extra).length > 0) {
      result.extra = extra;
    }

    return Object.keys(result).length > 0 ? (result as SchemaFieldMetadata) : undefined;
  }

  return undefined;
}

/** Extract validation checks from Zod _def.checks array */
function extractZodChecks(def: ZodTypeDef & Record<string, unknown>): Record<string, unknown> {
  const checks = def.checks as readonly Record<string, unknown>[] | undefined;
  if (!checks || checks.length === 0) return {};

  const result: Record<string, unknown> = {};
  for (const check of checks) {
    const kind = check["kind"] as string | undefined;
    if (!kind) continue;
    switch (kind) {
      case "min":
        result.minLength = check["value"];
        break;
      case "max":
        result.maxLength = check["value"];
        break;
      case "length":
        result.minLength = check["value"];
        result.maxLength = check["value"];
        break;
      case "regex":
        result.pattern = String(check["regex"]);
        break;
      case "email":
      case "url":
      case "uuid":
      case "cuid":
        result.format = kind;
        break;
      case "gte":
      case "min_value":
        result.minimum = check["value"];
        break;
      case "lte":
      case "max_value":
        result.maximum = check["value"];
        break;
      case "gt":
        result.exclusiveMinimum = check["value"];
        break;
      case "lt":
        result.exclusiveMaximum = check["value"];
        break;
      case "int":
        result.format = "int";
        break;
      default:
        result[kind] = check["value"] ?? true;
    }
  }
  return result;
}

/** Merge formbar metadata, checks, description, and context into SchemaFieldMetadata */
function mergeZodMetadata(
  schema: ZodLike,
  ctx: WalkContext,
  extra?: Record<string, unknown>,
): SchemaFieldMetadata | undefined {
  const def = schema._def;
  if (!def) return extra ? (extra as SchemaFieldMetadata) : undefined;

  const result: Record<string, unknown> = {};

  // Description from .describe()
  if (def.description) result.description = def.description;

  // Validation checks
  const checks = extractZodChecks(def);
  Object.assign(result, checks);

  // Enum values
  if (def["values"] && def.typeName === "ZodEnum") {
    result.enum = def["values"];
  }

  // Context flags
  if (ctx.nullable) result.nullable = true;
  if (ctx.readOnly) result.readOnly = true;

  // Extra type-specific metadata
  if (extra) Object.assign(result, extra);

  // Formbar metadata (from .meta({ formbar: {...} })) → extensions.formbar
  const formbarExtensions = extractFormbarMetadata(schema);
  if (formbarExtensions) {
    const existing = result.extensions as Record<string, Readonly<Record<string, unknown>>> | undefined;
    result.extensions = { ...existing, ...formbarExtensions };
  }

  return Object.keys(result).length > 0 ? (result as SchemaFieldMetadata) : undefined;
}
