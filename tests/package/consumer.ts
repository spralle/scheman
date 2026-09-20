import {
	type JsonSchema,
	type NodeRef,
	type SchemaDocument,
	type SchemaDocumentProvider,
	type StandardJSONSchemaV1,
	type StandardSchemaIssue,
	type StandardSchemaV1,
	ingestSchemaDocument,
	jsonSchemaProvider,
	standardJsonSchemaProvider,
	standardSchemaProvider,
} from "@scheman/core";
import type { StandardSchemaV1 as Official } from "@standard-schema/spec";

const schema: Official<string, number> = {
	"~standard": { version: 1, vendor: "fixture", validate: () => ({ value: 1 }) },
};
const result = ingestSchemaDocument(schema, { provider: standardSchemaProvider() });
const validator: StandardSchemaV1<string, number> | undefined = result.validator;
type Input = StandardSchemaV1.InferInput<NonNullable<typeof result.validator>>;
type Output = StandardSchemaV1.InferOutput<NonNullable<typeof result.validator>>;
const input: Input = "ok";
const output: Output = 1;
// @ts-expect-error Official input inference is preserved.
const badInput: Input = 1;
// @ts-expect-error Official output inference is preserved.
const badOutput: Output = "bad";
const issue: StandardSchemaIssue = { message: "bad", path: [{ key: "x" }, Symbol.for("x"), 0] };
validator?.["~standard"].validate(input, { libraryOptions: { strict: true } });
const conversion: StandardJSONSchemaV1<string, number> = {
	"~standard": {
		version: 1,
		vendor: "fixture",
		jsonSchema: {
			input: () => ({ type: "string" }),
			output: () => ({ type: "number" }),
		},
	},
};
ingestSchemaDocument(conversion, { provider: standardJsonSchemaProvider({ target: "draft-07", execution: "allow" }) });
const json: JsonSchema = false;
ingestSchemaDocument(json, { provider: jsonSchemaProvider() });
const custom: SchemaDocumentProvider = {
	name: "example",
	build(_schema, context) {
		const input = context.node("input", "", () => ({ kind: "primitive", type: "string" }));
		return { input, output: input };
	},
};
ingestSchemaDocument({}, { provider: custom });
export function rootKind(document: SchemaDocument, ref: NodeRef = document.root.input) {
	return document.nodes[ref.nodeId]?.kind;
}
// @ts-expect-error Provider selection is mandatory.
ingestSchemaDocument(json, {});
// @ts-expect-error The document is deeply readonly.
result.document.root.input.nodeId = "bad";
import type {
	// @ts-expect-error The flat API is removed.
	SchemaExtractor,
	// @ts-expect-error The flat API is removed.
	SchemaFieldInfo,
	// @ts-expect-error The flat API is removed.
	SchemaFieldMetadata,
	// @ts-expect-error The flat API is removed.
	SchemaFieldType,
	// @ts-expect-error The flat API is removed.
	SchemaIngestionResult,
	// @ts-expect-error The flat API is removed.
	SchemaMetadata,
} from "@scheman/core";
import {
	// @ts-expect-error Legacy runtime API is removed.
	dereferenceSchema,
	// @ts-expect-error Legacy runtime API is removed.
	extractFromJsonSchema,
	// @ts-expect-error Legacy runtime API is removed.
	extractFromZod,
	// @ts-expect-error Legacy runtime API is removed.
	extractFromZodV4,
	// @ts-expect-error Legacy runtime API is removed.
	ingestSchema,
	// @ts-expect-error Legacy runtime API is removed.
	isJsonSchema,
	// @ts-expect-error Legacy runtime API is removed.
	isZodSchema,
	// @ts-expect-error Legacy runtime API is removed.
	isZodV4Schema,
	// @ts-expect-error Legacy runtime API is removed.
	registerExtractor,
} from "@scheman/core";
void [input, output, badInput, badOutput, issue];
