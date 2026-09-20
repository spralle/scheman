import type { StandardJSONSchemaV1 } from "@standard-schema/spec";
import { data } from "../document/reader.js";
import type { NodeRef, Side } from "../document/types.js";
import { SchemaError } from "../errors.js";
import { selectDialect } from "./json-schema/dialect.js";
import { type JsonSchemaDialect, JsonSession } from "./json-schema/index.js";
import { schemaObject } from "./json-schema/reader.js";
import type { DocumentContext, SchemaDocumentProvider } from "./types.js";

export interface StandardJsonSchemaProviderOptions {
	readonly target: StandardJSONSchemaV1.Target;
	readonly execution: "allow" | "deny";
	readonly libraryOptions?: Record<string, unknown>;
}

export function standardJsonSchemaProvider(options: StandardJsonSchemaProviderOptions): SchemaDocumentProvider {
	const target = data(options, "target");
	const execution = data(options, "execution");
	if (typeof target !== "string" || !target.length || (execution !== "allow" && execution !== "deny")) {
		throw new SchemaError(
			"SCHEMA_INVALID_OPTIONS",
			"Standard JSON requires a target and explicit allow or deny execution",
		);
	}
	const libraryOptions = data(options, "libraryOptions");
	const libraryDescriptor = Object.getOwnPropertyDescriptor(options, "libraryOptions");
	if (libraryDescriptor && !("value" in libraryDescriptor))
		throw new SchemaError("SCHEMA_INVALID_OPTIONS", "libraryOptions must be passive data");
	if (libraryOptions !== undefined && !schemaObject(libraryOptions))
		throw new SchemaError("SCHEMA_INVALID_OPTIONS", "libraryOptions must be a passive record");
	const converterOptions: StandardJSONSchemaV1.Options =
		libraryOptions === undefined ? { target } : { target, libraryOptions: libraryOptions as Record<string, unknown> };
	return {
		name: "standard-json-schema",
		build(schema, context) {
			context.metadata({ provider: "standard-json-schema", target, execution });
			const session = new JsonSession(context);
			const convert = (side: Side) => convertSide(schema, side, context, session, converterOptions, execution);
			return { input: convert("input"), output: convert("output") };
		},
	};
}

function convertSide(
	schema: unknown,
	side: Side,
	context: DocumentContext,
	session: JsonSession,
	options: StandardJSONSchemaV1.Options,
	execution: "allow" | "deny",
): NodeRef {
	if (execution === "deny") return unavailable(context, side, "STANDARD_JSON_EXECUTION_DENIED");
	try {
		const standard = data(schema, "~standard");
		if (data(standard, "version") !== 1 || typeof data(standard, "vendor") !== "string")
			return unavailable(context, side, "STANDARD_JSON_INVALID_CONTRACT");
		const converter = data(standard, "jsonSchema");
		const method = data(converter, side);
		if (typeof method !== "function") return unavailable(context, side, "STANDARD_JSON_CONVERTER_UNAVAILABLE");
		const converted = method.call(converter, { ...options });
		if (!schemaObject(converted)) return unavailable(context, side, "STANDARD_JSON_INVALID_RESULT");
		const target =
			options.target === "draft-07" || options.target === "draft-2020-12"
				? (options.target as JsonSchemaDialect)
				: undefined;
		if (!target) context.diagnose("STANDARD_JSON_UNSUPPORTED_TARGET", side, "");
		return session.side(converted, side, selectDialect(converted, target));
	} catch {
		return unavailable(context, side, "STANDARD_JSON_CONVERSION_FAILED");
	}
}

function unavailable(context: DocumentContext, side: Side, code: string): NodeRef {
	context.diagnose(code, side, "");
	context.capability(side, "unavailable");
	return context.node(side, "", () => ({ kind: "unknown", reason: code }));
}
