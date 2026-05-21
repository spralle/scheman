import { isJsonSchema } from "./adapters/json-schema-detect.js";
import { extractFromJsonSchema } from "./adapters/json-schema-extractor.js";
import type { JsonSchema } from "./adapters/json-schema-types.js";
import { extractFromZod } from "./adapters/zod-extractor.js";
import { extractFromZodV4 } from "./adapters/zod4-extractor.js";
import { isStandardSchema, isZodSchema, isZodV4Schema } from "./detect.js";
import { SchemaError } from "./errors.js";
import { createValidationOnlyResult, findExtractor } from "./extractor-registry.js";
import type { SchemaIngestionResult } from "./types.js";

export function ingestSchema(schema: unknown): SchemaIngestionResult {
  if (isStandardSchema(schema) && isZodSchema(schema)) {
    return isZodV4Schema(schema) ? extractFromZodV4(schema) : extractFromZod(schema);
  }

  if (isStandardSchema(schema)) {
    const extractor = findExtractor(schema);
    if (extractor) {
      const fields = extractor.extract(schema);
      return { fields, metadata: { vendor: schema["~standard"].vendor } };
    }
    return createValidationOnlyResult(schema);
  }

  if (isJsonSchema(schema)) {
    return extractFromJsonSchema(schema as JsonSchema);
  }

  throw new SchemaError("SCHEMA_UNSUPPORTED", "Schema does not conform to Standard Schema v1 or JSON Schema");
}
