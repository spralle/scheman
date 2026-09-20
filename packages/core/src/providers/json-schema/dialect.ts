import { data } from "../../document/reader.js";
import { SchemaError } from "../../errors.js";
import type { JsonReader, JsonSchemaDialect, JsonSchemaProviderOptions } from "./types.js";

export function dialectOption(options: JsonSchemaProviderOptions): JsonSchemaDialect | undefined {
	if (!options || typeof options !== "object" || Array.isArray(options)) invalid();
	const descriptor = Object.getOwnPropertyDescriptor(options, "dialect");
	if (descriptor && !("value" in descriptor)) invalid();
	const dialect = data(options, "dialect");
	if (dialect !== undefined && dialect !== "draft-07" && dialect !== "draft-2020-12") invalid();
	return dialect as JsonSchemaDialect | undefined;
}

export function declaredDialect(value: unknown): JsonSchemaDialect | undefined {
	if (typeof value !== "string") return undefined;
	if (/^https?:\/\/json-schema\.org\/draft-07\/schema#?$/.test(value)) return "draft-07";
	if (/^https?:\/\/json-schema\.org\/draft\/2020-12\/schema#?$/.test(value)) return "draft-2020-12";
	return undefined;
}

export function selectDialect(schema: unknown, explicit?: JsonSchemaDialect): JsonSchemaDialect {
	return explicit ?? declaredDialect(data(schema, "$schema")) ?? "draft-2020-12";
}

export function checkDialect(source: unknown, path: string, reader: JsonReader): void {
	if (!reader.has(source, "$schema")) return;
	const declared = declaredDialect(reader.read(source, "$schema", path));
	if (!declared) reader.diagnose("JSON_UNSUPPORTED_DIALECT", path);
	else if (declared !== reader.dialect) reader.diagnose("JSON_DIALECT_CONFLICT", path);
}

function invalid(): never {
	throw new SchemaError("SCHEMA_INVALID_OPTIONS", "JSON dialect must be draft-07 or draft-2020-12 passive data");
}
