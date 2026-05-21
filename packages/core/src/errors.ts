export type SchemaErrorCode =
  | "SCHEMA_UNSUPPORTED"
  | "SCHEMA_ZOD_TRANSFORM_FORBIDDEN"
  | "SCHEMA_PARSE_FAILED"
  | "SCHEMA_META_CONFLICT";

export class SchemaError extends Error {
  readonly code: SchemaErrorCode;

  constructor(code: SchemaErrorCode, message: string) {
    super(message);
    this.name = "SchemaError";
    this.code = code;
  }
}
