import { SchemaError } from "../errors.js";
import type {
  SchemaFieldInfo,
  SchemaFieldMetadata,
  SchemaFieldType,
  SchemaIngestionResult,
  SchemaMetadata,
} from "../types.js";

/**
 * Zod v4 introspection interfaces. v4 replaces `_def` with a `_zod` property
 * containing `def` (schema definition) and `traits` (type markers).
 * When `_zod` is unavailable, we fall back to Standard Schema validation-only mode.
 */
interface ZodV4Internal {
  readonly _zod?: {
    readonly def?: Readonly<Record<string, unknown>>;
    readonly traits?: ReadonlySet<string> | readonly string[];
  };
}

interface WalkContext {
  nullable?: boolean;
  readOnly?: boolean;
  defaultValue?: unknown;
}

export function extractFromZodV4(schema: unknown): SchemaIngestionResult {
  const fields: SchemaFieldInfo[] = [];

  const v4 = schema as ZodV4Internal;
  if (!v4._zod?.def) {
    return { fields: [], metadata: { vendor: "zod4", validationOnly: true } };
  }

  const metadata: SchemaMetadata = { vendor: "zod4" };
  walkZodV4(schema, "", fields, true);
  return { fields, metadata };
}

function walkZodV4(
  schema: unknown,
  prefix: string,
  fields: SchemaFieldInfo[],
  required: boolean,
  ctx: WalkContext = {},
): void {
  const v4 = schema as ZodV4Internal;
  const def = v4._zod?.def;
  if (!def) return;

  const type = def["type"] as string | undefined;
  if (!type) return;

  // Unwrap wrappers
  if (type === "optional") {
    walkZodV4Inner(def, "innerType", prefix, fields, false, ctx);
    return;
  }
  if (type === "nullable") {
    walkZodV4Inner(def, "innerType", prefix, fields, required, { ...ctx, nullable: true });
    return;
  }
  if (type === "default") {
    const defaultValue =
      typeof def["defaultValue"] === "function" ? (def["defaultValue"] as () => unknown)() : undefined;
    walkZodV4Inner(def, "innerType", prefix, fields, false, { ...ctx, defaultValue });
    return;
  }
  if (type === "effects" || type === "pipeline") {
    const key = type === "effects" ? "schema" : "in";
    walkZodV4Inner(def, key, prefix, fields, required, ctx);
    return;
  }
  if (type === "lazy") {
    const getter = def["getter"] as (() => unknown) | undefined;
    if (getter) walkZodV4(getter(), prefix, fields, required, ctx);
    return;
  }
  if (type === "branded" || type === "readonly" || type === "catch") {
    const key = type === "branded" ? "type" : "innerType";
    const nextCtx = type === "readonly" ? { ...ctx, readOnly: true } : ctx;
    walkZodV4Inner(def, key, prefix, fields, required, nextCtx);
    return;
  }

  // Structural types
  if (type === "object") {
    const shape = def["shape"] as Record<string, unknown> | undefined;
    if (shape) {
      for (const [key, value] of Object.entries(shape)) {
        const childPath = prefix ? `${prefix}.${key}` : key;
        walkZodV4(value, childPath, fields, true);
      }
    }
    return;
  }

  if (type === "array") {
    const metadata = buildV4Metadata(def, ctx);
    if (prefix) {
      fields.push({ path: prefix, type: "array", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (type === "intersection") {
    const left = def["left"] as unknown;
    const right = def["right"] as unknown;
    if (left) walkZodV4(left, prefix, fields, required, ctx);
    if (right) walkZodV4(right, prefix, fields, required, ctx);
    return;
  }

  if (type === "record") {
    const metadata = buildV4Metadata(def, ctx, { additionalProperties: true });
    if (prefix) {
      fields.push({ path: prefix, type: "object", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (type === "tuple") {
    const items = def["items"] as readonly unknown[] | undefined;
    const metadata = buildV4Metadata(def, ctx, { tuple: true, itemCount: items?.length ?? 0 });
    if (prefix) {
      fields.push({ path: prefix, type: "array", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (type === "literal") {
    const value = def["value"];
    const litType = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
    const metadata = buildV4Metadata(def, ctx, { const: value });
    if (prefix) {
      fields.push({ path: prefix, type: litType as SchemaFieldType, required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  if (type === "nativeEnum") {
    const values = def["values"] as Record<string, unknown> | undefined;
    const enumValues = values ? Object.values(values) : [];
    const metadata = buildV4Metadata(def, ctx, { enum: enumValues });
    if (prefix) {
      fields.push({ path: prefix, type: "enum", required, ...(metadata ? { metadata } : {}) });
    }
    return;
  }

  // Leaf types
  const fieldType = mapZodV4Type(type);
  const metadata = buildV4Metadata(def, ctx);
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

function walkZodV4Inner(
  def: Readonly<Record<string, unknown>>,
  key: string,
  prefix: string,
  fields: SchemaFieldInfo[],
  required: boolean,
  ctx: WalkContext = {},
): void {
  const inner = def[key];
  if (inner && typeof inner === "object") {
    walkZodV4(inner, prefix, fields, required, ctx);
  }
}

function mapZodV4Type(type: string): SchemaFieldType {
  switch (type) {
    case "string":
      return "string";
    case "number":
    case "float32":
    case "float64":
      return "number";
    case "int":
    case "bigint":
      return "integer";
    case "boolean":
      return "boolean";
    case "date":
      return "date";
    case "enum":
      return "enum";
    case "union":
    case "discriminatedUnion":
      return "union";
    case "array":
      return "array";
    case "object":
      return "object";
    default:
      return "unknown";
  }
}

/** Extract validation checks from v4 def.checks */
function extractV4Checks(def: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const checks = def["checks"] as readonly Record<string, unknown>[] | undefined;
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

/** Build metadata from v4 def, context, and extras */
function buildV4Metadata(
  def: Readonly<Record<string, unknown>>,
  ctx: WalkContext,
  extra?: Record<string, unknown>,
): SchemaFieldMetadata | undefined {
  const result: Record<string, unknown> = {};

  // Description
  const desc = def["description"] as string | undefined;
  if (desc) result.description = desc;

  // Checks
  Object.assign(result, extractV4Checks(def));

  // Enum values
  if (def["values"] && def["type"] === "enum") {
    result.enum = def["values"];
  }

  // Context
  if (ctx.nullable) result.nullable = true;
  if (ctx.readOnly) result.readOnly = true;

  // Extra
  if (extra) Object.assign(result, extra);

  // Formbar metadata
  const rawMeta = def["metadata"] as Record<string, unknown> | undefined;
  if (rawMeta && "x-formbar" in rawMeta) {
    throw new SchemaError(
      "SCHEMA_ZOD_TRANSFORM_FORBIDDEN",
      "x-formbar is not allowed in Zod metadata. Use .meta({ formbar: { ... } }) instead.",
    );
  }
  if (rawMeta && typeof rawMeta === "object" && "formbar" in rawMeta) {
    const formbar = rawMeta["formbar"] as Record<string, unknown>;
    Object.assign(result, formbar);
  }

  return Object.keys(result).length > 0 ? (result as SchemaFieldMetadata) : undefined;
}
