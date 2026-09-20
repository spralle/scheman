import type { StandardSchemaV1 } from "@standard-schema/spec";
import { DocumentBuilder } from "./document/builder.js";
import { createContext } from "./document/context.js";
import { type LimitOptions, resolveLimits } from "./document/limits.js";
import { data } from "./document/reader.js";
import type { SchemaDocument } from "./document/types.js";
import { SchemaError } from "./errors.js";
import type { SchemaDocumentProvider } from "./providers/types.js";
import { isStandardSchema } from "./standard.js";

export interface IngestDocumentOptions {
	readonly provider: SchemaDocumentProvider;
	readonly limits?: LimitOptions;
}
export interface IngestDocumentResult<Input = unknown, Output = Input> {
	readonly document: SchemaDocument;
	readonly validator?: StandardSchemaV1<Input, Output>;
}

export function ingestSchemaDocument<Input, Output>(
	schema: StandardSchemaV1<Input, Output>,
	options: IngestDocumentOptions,
): IngestDocumentResult<Input, Output>;
export function ingestSchemaDocument(schema: unknown, options: IngestDocumentOptions): IngestDocumentResult;
export function ingestSchemaDocument(schema: unknown, options: IngestDocumentOptions): IngestDocumentResult {
	const provider = data(options, "provider");
	const build = data(provider, "build");
	if (typeof data(provider, "name") !== "string" || typeof build !== "function") {
		throw new SchemaError("SCHEMA_INVALID_OPTIONS", "An explicit schema document provider is required");
	}
	const limitsDescriptor = Object.getOwnPropertyDescriptor(options, "limits");
	if (limitsDescriptor && !("value" in limitsDescriptor)) {
		throw new SchemaError("SCHEMA_INVALID_OPTIONS", "Limits must be passive data");
	}
	const builder = new DocumentBuilder(resolveLimits(data(options, "limits")));
	const document = runProvider(builder, () => build.call(provider, schema, createContext(builder)));
	return isStandardSchema(schema) ? { document, validator: schema } : { document };
}

function runProvider(
	builder: DocumentBuilder,
	build: () => ReturnType<SchemaDocumentProvider["build"]>,
): SchemaDocument {
	try {
		return builder.finish(build());
	} catch (error) {
		if (error instanceof SchemaError) throw error;
		throw new SchemaError("SCHEMA_INVALID_PROVIDER", "Document provider failed to build a valid graph");
	}
}
