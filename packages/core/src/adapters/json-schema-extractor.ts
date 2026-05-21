import type {
  SchemaFieldInfo,
  SchemaFieldMetadata,
  SchemaFieldType,
  SchemaIngestionResult,
  SchemaMetadata,
} from "../types.js";
import { dereferenceSchema } from "./json-schema-deref.js";
import type { JsonSchema } from "./json-schema-types.js";

/** Extract x-* extension keys from a JSON Schema into a grouped record (e.g., x-formbar → extensions.formbar) */
function extractExtensions(
  schema: JsonSchema,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined {
  const extensions: Record<string, Readonly<Record<string, unknown>>> = {};
  let found = false;
  for (const key of Object.keys(schema)) {
    if (key.startsWith("x-")) {
      const name = key.slice(2);
      const value = schema[key as `x-${string}`];
      if (value !== undefined && typeof value === "object" && value !== null && !Array.isArray(value)) {
        extensions[name] = value as Readonly<Record<string, unknown>>;
        found = true;
      }
    }
  }
  return found ? extensions : undefined;
}

function buildMetadata(standardMeta: Record<string, unknown>, schema: JsonSchema): SchemaFieldMetadata | undefined {
  const extensions = extractExtensions(schema);
  const hasContent = Object.keys(standardMeta).length > 0 || extensions !== undefined;
  if (!hasContent) return undefined;

  return {
    ...standardMeta,
    ...(extensions ? { extensions } : {}),
  } as SchemaFieldMetadata;
}

export function extractFromJsonSchema(rawSchema: JsonSchema): SchemaIngestionResult {
  const schema = dereferenceSchema(rawSchema);
  const fields: SchemaFieldInfo[] = [];

  const metadata: SchemaMetadata = {
    vendor: "json-schema",
    ...(schema.title !== undefined ? { title: schema.title } : {}),
    ...(schema.description !== undefined ? { description: schema.description } : {}),
  };

  walkJsonSchema(schema, "", fields);

  return { fields, metadata };
}

/** Merge allOf subschemas into a single combined schema */
function mergeAllOf(schema: JsonSchema): JsonSchema {
  if (!schema.allOf || schema.allOf.length === 0) return schema;

  const merged: Record<string, unknown> = { ...schema };
  delete merged.allOf;

  let mergedProperties: Record<string, JsonSchema> = { ...(schema.properties ?? {}) };
  let mergedRequired: string[] = [...(schema.required ?? [])];

  for (const subschema of schema.allOf) {
    const resolved = mergeAllOf(subschema);
    if (resolved.properties) {
      mergedProperties = { ...mergedProperties, ...resolved.properties };
    }
    if (resolved.required) {
      mergedRequired = [...mergedRequired, ...resolved.required];
    }
    // Merge other keywords (type, etc.) — subschema wins if parent doesn't have it
    for (const [key, value] of Object.entries(resolved)) {
      if (key !== "properties" && key !== "required" && !(key in merged)) {
        merged[key] = value;
      }
    }
  }

  if (Object.keys(mergedProperties).length > 0) {
    merged.properties = mergedProperties;
  }
  if (mergedRequired.length > 0) {
    merged.required = [...new Set(mergedRequired)];
  }

  return merged as JsonSchema;
}

function walkJsonSchema(
  schema: JsonSchema,
  prefix: string,
  fields: SchemaFieldInfo[],
  parentRequired?: readonly string[],
  fieldName?: string,
): void {
  const effective = mergeAllOf(schema);
  const resolvedType = resolveType(effective);

  if (resolvedType === "object" && effective.properties) {
    for (const [key, childSchema] of Object.entries(effective.properties)) {
      const childPath = prefix ? `${prefix}.${key}` : key;
      walkJsonSchema(childSchema, childPath, fields, effective.required, key);
    }
    // Also extract if/then/else conditional fields at object level
    if (effective.if && (effective.then ?? effective.else)) {
      walkConditionalFields(effective, prefix, fields);
    }
    return;
  }

  if (resolvedType === "array") {
    const isRequired = fieldName !== undefined && parentRequired?.includes(fieldName) === true;
    const arrayStandardMeta: Record<string, unknown> = {};
    if (effective.title !== undefined) arrayStandardMeta.title = effective.title;
    if (effective.description !== undefined) arrayStandardMeta.description = effective.description;
    if (effective.default !== undefined) arrayStandardMeta.default = effective.default;
    if (effective.minItems !== undefined) arrayStandardMeta.minItems = effective.minItems;
    if (effective.maxItems !== undefined) arrayStandardMeta.maxItems = effective.maxItems;
    if (effective.uniqueItems !== undefined) arrayStandardMeta.uniqueItems = effective.uniqueItems;

    const arrayMetadata = buildMetadata(arrayStandardMeta, effective);
    fields.push({
      path: prefix,
      type: "array",
      required: isRequired,
      ...(arrayMetadata ? { metadata: arrayMetadata } : {}),
    });

    const itemSchema = effective.items;
    if (itemSchema && typeof itemSchema === "object" && !Array.isArray(itemSchema)) {
      const items = itemSchema as JsonSchema;
      if (items.properties) {
        for (const [key, childSchema] of Object.entries(items.properties)) {
          const childPath = prefix ? `${prefix}.${key}` : key;
          walkJsonSchema(childSchema, childPath, fields, items.required, key);
        }
      }
    }

    return;
  }

  // oneOf/anyOf: emit union field and walk variant fields
  if (effective.oneOf ?? effective.anyOf) {
    if (prefix) {
      const isRequired = fieldName !== undefined && parentRequired?.includes(fieldName) === true;
      const standardMeta: Record<string, unknown> = {};
      if (effective.title !== undefined) standardMeta.title = effective.title;
      if (effective.description !== undefined) standardMeta.description = effective.description;
      const metadata = buildMetadata(standardMeta, effective);
      fields.push({
        path: prefix,
        type: "union",
        required: isRequired,
        ...(metadata ? { metadata } : {}),
      });
      walkUnionVariants(effective, prefix, fields);
    }
    return;
  }

  // if/then/else: extract conditional fields
  if (effective.if && (effective.then ?? effective.else)) {
    walkConditionalFields(effective, prefix, fields);
  }

  if (!prefix) return;

  const isRequired = fieldName !== undefined && parentRequired?.includes(fieldName) === true;
  const fieldType = mapJsonSchemaType(effective);

  const standardMeta: Record<string, unknown> = {};
  if (effective.title !== undefined) standardMeta.title = effective.title;
  if (effective.description !== undefined) standardMeta.description = effective.description;
  if (effective.enum !== undefined) standardMeta.enum = effective.enum;
  if (effective.default !== undefined) standardMeta.default = effective.default;
  if (effective.minimum !== undefined) standardMeta.minimum = effective.minimum;
  if (effective.maximum !== undefined) standardMeta.maximum = effective.maximum;
  if (effective.exclusiveMinimum !== undefined) standardMeta.exclusiveMinimum = effective.exclusiveMinimum;
  if (effective.exclusiveMaximum !== undefined) standardMeta.exclusiveMaximum = effective.exclusiveMaximum;
  if (effective.minLength !== undefined) standardMeta.minLength = effective.minLength;
  if (effective.maxLength !== undefined) standardMeta.maxLength = effective.maxLength;
  if (effective.format !== undefined) standardMeta.format = effective.format;
  if (effective.pattern !== undefined) standardMeta.pattern = effective.pattern;
  if (effective.readOnly !== undefined) standardMeta.readOnly = effective.readOnly;
  if (effective.writeOnly !== undefined) standardMeta.writeOnly = effective.writeOnly;
  if (effective.deprecated !== undefined) standardMeta.deprecated = effective.deprecated;
  if (effective.dependentRequired !== undefined) standardMeta.dependentRequired = effective.dependentRequired;

  const metadata = buildMetadata(standardMeta, effective);

  fields.push({
    path: prefix,
    type: fieldType,
    required: isRequired,
    ...(effective.default !== undefined
      ? { defaultValue: effective.default }
      : effective.const !== undefined
        ? { defaultValue: effective.const }
        : {}),
    ...(metadata ? { metadata } : {}),
  });
}

function resolveType(schema: JsonSchema): string | undefined {
  if (typeof schema.type === "string") return schema.type;
  if (Array.isArray(schema.type) && schema.type.length > 0) {
    const nonNull = schema.type.filter((t) => t !== "null");
    return (nonNull.length > 0 ? nonNull[0] : schema.type[0]) as string;
  }
  if (schema.properties) return "object";
  if (schema.items) return "array";
  if (schema.enum) return "enum";
  return undefined;
}

function mapJsonSchemaType(schema: JsonSchema): SchemaFieldType {
  if (schema.enum) return "enum";
  if (schema.oneOf ?? schema.anyOf) return "union";

  const type = resolveType(schema);
  switch (type) {
    case "string":
      if (schema.format === "date") return "date";
      if (schema.format === "date-time") return "datetime";
      return "string";
    case "number":
      return "number";
    case "integer":
      return "integer";
    case "boolean":
      return "boolean";
    case "object":
      return "object";
    case "array":
      return "array";
    default:
      return "unknown";
  }
}

/** Walk oneOf/anyOf variants and collect all fields as a union */
function walkUnionVariants(schema: JsonSchema, prefix: string, fields: SchemaFieldInfo[]): void {
  const variants = schema.oneOf ?? schema.anyOf ?? [];
  const variantFields: Map<string, { count: number; field: SchemaFieldInfo }> = new Map();

  for (const variant of variants) {
    const variantResult: SchemaFieldInfo[] = [];
    walkJsonSchema(variant, prefix, variantResult);
    for (const field of variantResult) {
      const existing = variantFields.get(field.path);
      if (existing) {
        existing.count++;
      } else {
        variantFields.set(field.path, { count: 1, field });
      }
    }
  }

  const totalVariants = variants.length;
  for (const [, { count, field }] of variantFields) {
    const isUniversal = count === totalVariants;
    fields.push({ ...field, required: isUniversal });
  }
}

/** Walk if/then/else and extract conditional fields as optional */
function walkConditionalFields(schema: JsonSchema, prefix: string, fields: SchemaFieldInfo[]): void {
  const branches = [schema.then, schema.else].filter(Boolean) as JsonSchema[];
  for (const branch of branches) {
    const branchFields: SchemaFieldInfo[] = [];
    walkJsonSchema(branch, prefix, branchFields);
    for (const field of branchFields) {
      fields.push({ ...field, required: false });
    }
  }
}
