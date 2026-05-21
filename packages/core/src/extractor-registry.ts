import type { SchemaFieldInfo, SchemaIngestionResult, StandardSchemaV1 } from "./types.js";

/** Pluggable extractor for non-Zod Standard Schema vendors */
export interface SchemaExtractor {
  readonly vendor: string;
  canExtract(schema: unknown): boolean;
  extract(schema: unknown): readonly SchemaFieldInfo[];
}

const registry: SchemaExtractor[] = [];

export function registerExtractor(extractor: SchemaExtractor): void {
  registry.push(extractor);
}

export function findExtractor(schema: unknown): SchemaExtractor | undefined {
  return registry.find((e) => e.canExtract(schema));
}

/** Reset registry — for testing only */
export function clearExtractorRegistry(): void {
  registry.length = 0;
}

/**
 * Validation-only fallback for Standard Schema vendors with no extractor.
 * Returns empty fields and delegates validation to ~standard.validate.
 */
export function createValidationOnlyResult(schema: StandardSchemaV1): SchemaIngestionResult {
  return {
    fields: [],
    metadata: { vendor: schema["~standard"].vendor, validationOnly: true },
  };
}
