import type { StandardSchemaV1 } from "@standard-schema/spec";
import { ingestSchemaDocument } from "../src/ingest-document.js";
import { standardSchemaProvider } from "../src/providers/standard-schema.js";
import type { StandardSchemaIssue, StandardSchemaResult } from "../src/standard.js";

const schema: StandardSchemaV1<string, number> = {
	"~standard": {
		version: 1,
		vendor: "declaration-fixture",
		types: undefined,
		validate(value, options) {
			const libraryOptions: Record<string, unknown> | undefined = options?.libraryOptions;
			void libraryOptions;
			return typeof value === "string"
				? { value: value.length }
				: {
						issues: [{ message: "Expected string", path: ["root", { key: 0 }, Symbol.for("key")] }],
					};
		},
	},
};

const result = ingestSchemaDocument(schema, { provider: standardSchemaProvider() });
const validator: StandardSchemaV1<string, number> | undefined = result.validator;
const validation: StandardSchemaResult<number> | Promise<StandardSchemaResult<number>> | undefined = validator?.[
	"~standard"
].validate("value", { libraryOptions: { strict: true } });
void validation;

type Input = StandardSchemaV1.InferInput<NonNullable<typeof result.validator>>;
type Output = StandardSchemaV1.InferOutput<NonNullable<typeof result.validator>>;
const input: Input = "value";
const output: Output = 1;
void input;
void output;

// @ts-expect-error The input remains string rather than unknown.
const invalidInput: Input = 1;
// @ts-expect-error The output remains number rather than unknown.
const invalidOutput: Output = "value";
void invalidInput;
void invalidOutput;

const issue: StandardSchemaIssue = { message: "bad", path: [{ key: "field" }, 0] };
const officialIssue: StandardSchemaV1.Issue = issue;
void officialIssue;

// @ts-expect-error Provider selection is mandatory.
ingestSchemaDocument(schema, {});
// @ts-expect-error The owned graph is deeply readonly.
result.document.root.input.nodeId = "replacement";
