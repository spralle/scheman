export { dereferenceSchema } from "./adapters/json-schema-deref.js";
export { isJsonSchema } from "./adapters/json-schema-detect.js";
export { extractFromJsonSchema } from "./adapters/json-schema-extractor.js";
export type { JsonSchema } from "./adapters/json-schema-types.js";
export { extractFromZod } from "./adapters/zod-extractor.js";
export { extractFromZodV4 } from "./adapters/zod4-extractor.js";
export { isStandardSchema, isZodSchema, isZodV4Schema } from "./detect.js";
export type { SchemaErrorCode } from "./errors.js";
export { SchemaError } from "./errors.js";
export type { SchemaExtractor } from "./extractor-registry.js";
export {
  clearExtractorRegistry,
  createValidationOnlyResult,
  findExtractor,
  registerExtractor,
} from "./extractor-registry.js";
export { ingestSchema } from "./ingest.js";
export type { MergeInput, MetadataSource } from "./metadata-merge.js";
export {
  mergeMetadata,
  mergeSamePrecedence,
  structuralEqual,
} from "./metadata-merge.js";
export type { SchemaMiddleware } from "./middleware.js";
export { applySchemaMiddleware } from "./middleware.js";
export type {
  SchemaFieldInfo,
  SchemaFieldMetadata,
  SchemaFieldType,
  SchemaIngestionResult,
  SchemaMetadata,
  StandardSchemaIssue,
  StandardSchemaResult,
  StandardSchemaV1,
} from "./types.js";
export { checkType, isObject } from "./utils.js";
