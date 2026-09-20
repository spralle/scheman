export type { DocumentLimits, LimitOptions } from "./document/limits.js";
export type { Applicators, Primitive, PropertyEdge, SchemaNode } from "./document/nodes.js";
export type {
	Availability,
	Definition,
	Diagnostic,
	NodeRef,
	OwnedValue,
	SchemaDocument,
	Side,
} from "./document/types.js";
export type { SchemaErrorCode } from "./errors.js";
export { SchemaError } from "./errors.js";
export type { IngestDocumentOptions, IngestDocumentResult } from "./ingest-document.js";
export { ingestSchemaDocument } from "./ingest-document.js";
export type { MergeInput, MetadataSource } from "./metadata-merge.js";
export { mergeMetadata, mergeSamePrecedence, structuralEqual } from "./metadata-merge.js";
export type { SchemaMiddleware } from "./middleware.js";
export { applySchemaMiddleware } from "./middleware.js";
export type {
	JsonSchema,
	JsonSchemaDialect,
	JsonSchemaObject,
	JsonSchemaProviderOptions,
} from "./providers/json-schema/index.js";
export { jsonSchemaProvider } from "./providers/json-schema/index.js";
export type { StandardJsonSchemaProviderOptions } from "./providers/standard-json-schema.js";
export { standardJsonSchemaProvider } from "./providers/standard-json-schema.js";
export { standardSchemaProvider } from "./providers/standard-schema.js";
export type { DocumentContext, SchemaDocumentProvider } from "./providers/types.js";
export type { ZodProviderOptions } from "./providers/zod/types.js";
export { zod3Provider } from "./providers/zod3/index.js";
export { zod4Provider } from "./providers/zod4/index.js";
export type { StandardJSONSchemaV1, StandardSchemaIssue, StandardSchemaResult, StandardSchemaV1 } from "./standard.js";
export { isStandardSchema } from "./standard.js";
export { checkType, isObject } from "./utils.js";
