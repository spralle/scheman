import type { SchemaDocumentProvider } from "./types.js";

export function standardSchemaProvider(): SchemaDocumentProvider {
	return {
		name: "standard-schema",
		build(_schema, context) {
			context.capability("input", "unavailable");
			context.capability("output", "unavailable");
			return {
				input: context.node("input", "", () => ({ kind: "unknown", reason: "validation-only" })),
				output: context.node("output", "", () => ({ kind: "unknown", reason: "validation-only" })),
			};
		},
	};
}
