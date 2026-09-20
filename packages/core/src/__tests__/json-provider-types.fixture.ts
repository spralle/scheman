import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { ingestSchemaDocument } from "../ingest-document.js";
import { type JsonSchema, type JsonSchemaObject, jsonSchemaProvider } from "../providers/json-schema/index.js";
import { standardJsonSchemaProvider } from "../providers/standard-json-schema.js";

const object: JsonSchemaObject = {
	type: ["object", "null"],
	properties: { field: { type: "array", prefixItems: [true, { type: "string" }], items: false } },
	additionalProperties: false,
	allOf: [{ if: { required: ["field"] }, else: true }],
	dependentRequired: { field: ["other"] },
	unknownExtension: { any: "data" },
};
const schemas: readonly JsonSchema[] = [false, true, object];
const prefix: readonly JsonSchema[] | undefined = object.prefixItems;
const conditional: JsonSchema | undefined = object.then;
void schemas;
void prefix;
void conditional;
jsonSchemaProvider({ dialect: "draft-07" });
jsonSchemaProvider({ dialect: "draft-2020-12" });
// @ts-expect-error Only the two implemented JSON dialects are selectable directly.
jsonSchemaProvider({ dialect: "draft-04" });

declare const source: StandardSchemaV1<string, number> & StandardJSONSchemaV1<string, number>;
const result = ingestSchemaDocument(source, {
	provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow", libraryOptions: { any: true } }),
});
type Input = StandardSchemaV1.InferInput<NonNullable<typeof result.validator>>;
type Output = StandardSchemaV1.InferOutput<NonNullable<typeof result.validator>>;
const input: Input = "value";
const output: Output = 1;
void input;
void output;
// @ts-expect-error Input inference remains string, not unknown or output.
const invalidInput: Input = 1;
// @ts-expect-error Output inference remains number, not unknown or input.
const invalidOutput: Output = "value";
void invalidInput;
void invalidOutput;

declare const target: StandardJSONSchemaV1.Target;
standardJsonSchemaProvider({ target, execution: "deny" });
// @ts-expect-error Conversion permission must be explicit.
standardJsonSchemaProvider({ target: "draft-07" });
// @ts-expect-error Conversion target must be explicit.
standardJsonSchemaProvider({ execution: "allow" });
