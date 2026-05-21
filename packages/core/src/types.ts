// Standard Schema v1 interface (vendor-agnostic)
// See: https://github.com/standard-schema/standard-schema
export interface StandardSchemaV1<Input = unknown, Output = Input> {
  readonly "~standard": {
    readonly version: 1;
    readonly vendor: string;
    readonly validate: (value: unknown) => StandardSchemaResult<Output> | Promise<StandardSchemaResult<Output>>;
  };
  readonly "~types"?: {
    readonly input: Input;
    readonly output: Output;
  };
}

export type StandardSchemaResult<T> =
  | { readonly value: T; readonly issues?: undefined }
  | { readonly value?: undefined; readonly issues: readonly StandardSchemaIssue[] };

export interface StandardSchemaIssue {
  readonly message: string;
  readonly path?: readonly (string | number | symbol)[];
}

/** Typed metadata produced by schema extractors (source-agnostic) */
export interface SchemaFieldMetadata {
  readonly title?: string;
  readonly description?: string;
  readonly enum?: readonly unknown[];
  readonly default?: unknown;
  readonly minimum?: number;
  readonly maximum?: number;
  readonly exclusiveMinimum?: number;
  readonly exclusiveMaximum?: number;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly format?: string;
  readonly pattern?: string;
  // Array constraints
  readonly minItems?: number;
  readonly maxItems?: number;
  readonly uniqueItems?: boolean;
  // Annotations
  readonly readOnly?: boolean;
  readonly writeOnly?: boolean;
  readonly deprecated?: boolean;
  readonly nullable?: boolean;
  // Structural
  readonly dependentRequired?: Readonly<Record<string, readonly string[]>>;
  readonly additionalProperties?: boolean;
  readonly tuple?: boolean;
  readonly const?: unknown;
  readonly variants?: readonly unknown[];
  // Extension data from x-* keys (e.g., x-formbar → extensions.formbar)
  readonly extensions?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  // Display label (from x-* extensions or schema extractors)
  readonly label?: string;
  // Extra vendor-specific metadata
  readonly extra?: Readonly<Record<string, unknown>>;
  // UI hints (from x-* extensions)
  readonly placeholder?: string;
  readonly options?: readonly unknown[];
  readonly widget?: string;
}

// Extracted field info from schema ingestion
export interface SchemaFieldInfo {
  readonly path: string;
  readonly type: SchemaFieldType;
  readonly required: boolean;
  readonly defaultValue?: unknown;
  readonly metadata?: SchemaFieldMetadata;
}

export type SchemaFieldType =
  | "string"
  | "number"
  | "integer"
  | "boolean"
  | "date"
  | "datetime"
  | "array"
  | "object"
  | "enum"
  | "union"
  | "unknown";

/** Typed metadata produced by schema ingestion at the root level */
export interface SchemaMetadata {
  readonly vendor?: string;
  readonly title?: string;
  readonly description?: string;
  readonly validationOnly?: boolean;
  readonly extra?: Readonly<Record<string, unknown>>;
}

// Schema ingestion result
export interface SchemaIngestionResult {
  readonly fields: readonly SchemaFieldInfo[];
  readonly metadata: SchemaMetadata;
}
