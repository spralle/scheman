import { describe, expect, it } from "vitest";
import { extractFromZod } from "../adapters/zod-extractor.js";
import { extractFromZodV4 } from "../adapters/zod4-extractor.js";

function zodV3(typeName: string, extra: Record<string, unknown> = {}) {
	return {
		"~standard": { version: 1, vendor: "zod", validate: () => ({ value: undefined }) },
		_def: { typeName, ...extra },
	};
}

function zodV3Object(shape: Record<string, unknown>) {
	return zodV3("ZodObject", { shape: () => shape });
}

function zodV3Optional(inner: unknown) {
	return zodV3("ZodOptional", { innerType: inner });
}

function zodV4(type: string, extra: Record<string, unknown> = {}) {
	return { _zod: { def: { type, ...extra } } };
}

function zodV4Object(shape: Record<string, unknown>) {
	return zodV4("object", { shape });
}

describe("extractFromZod", () => {
	describe("basic leaf types", () => {
		it("maps ZodString to string", () => {
			const schema = zodV3Object({ name: zodV3("ZodString") });
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "name", type: "string", required: true });
		});

		it("maps ZodNumber to number", () => {
			const schema = zodV3Object({ age: zodV3("ZodNumber") });
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "age", type: "number", required: true });
		});

		it("maps ZodBoolean to boolean", () => {
			const schema = zodV3Object({ active: zodV3("ZodBoolean") });
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "active", type: "boolean", required: true });
		});

		it("maps ZodDate to date", () => {
			const schema = zodV3Object({ created: zodV3("ZodDate") });
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "created", type: "date", required: true });
		});
	});

	describe("object traversal", () => {
		it("extracts fields from object shape", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString"),
				age: zodV3("ZodNumber"),
			});
			const result = extractFromZod(schema);
			expect(result.fields).toHaveLength(2);
			expect(result.fields[0].path).toBe("name");
			expect(result.fields[1].path).toBe("age");
		});

		it("handles nested objects with dot-path notation", () => {
			const schema = zodV3Object({
				address: zodV3Object({
					street: zodV3("ZodString"),
					city: zodV3("ZodString"),
				}),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].path).toBe("address.street");
			expect(result.fields[1].path).toBe("address.city");
		});
	});

	describe("optional fields", () => {
		it("marks optional fields as not required", () => {
			const schema = zodV3Object({
				nickname: zodV3Optional(zodV3("ZodString")),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "nickname", type: "string", required: false });
		});
	});

	describe("nullable fields", () => {
		it("sets metadata.nullable to true", () => {
			const schema = zodV3Object({
				bio: zodV3("ZodNullable", { innerType: zodV3("ZodString") }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "bio", type: "string", required: true });
			expect(result.fields[0].metadata?.nullable).toBe(true);
		});
	});

	describe("default values", () => {
		it("marks field as not required and sets defaultValue", () => {
			const schema = zodV3Object({
				role: zodV3("ZodDefault", {
					innerType: zodV3("ZodString"),
					defaultValue: () => "user",
				}),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].required).toBe(false);
			expect(result.fields[0].defaultValue).toBe("user");
		});
	});

	describe("enum types", () => {
		it("extracts enum values", () => {
			const schema = zodV3Object({
				status: zodV3("ZodEnum", { values: ["active", "inactive"] }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].type).toBe("enum");
			expect(result.fields[0].metadata?.enum).toEqual(["active", "inactive"]);
		});
	});

	describe("array type", () => {
		it("maps ZodArray to array", () => {
			const schema = zodV3Object({
				tags: zodV3("ZodArray", { type: zodV3("ZodString") }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "tags", type: "array", required: true });
		});
	});

	describe("union type", () => {
		it("maps ZodUnion to union", () => {
			const schema = zodV3Object({
				value: zodV3("ZodUnion", { options: [] }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "value", type: "union", required: true });
		});
	});

	describe("description", () => {
		it("extracts description from _def.description", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString", { description: "The user name" }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].metadata?.description).toBe("The user name");
		});
	});

	describe("checks extraction", () => {
		it("extracts min/max length from checks", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString", {
					checks: [
						{ kind: "min", value: 3 },
						{ kind: "max", value: 50 },
					],
				}),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].metadata?.minLength).toBe(3);
			expect(result.fields[0].metadata?.maxLength).toBe(50);
		});
	});

	describe("ZodReadonly wrapper", () => {
		it("sets metadata.readOnly to true", () => {
			const schema = zodV3Object({
				id: zodV3("ZodReadonly", { innerType: zodV3("ZodString") }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].metadata?.readOnly).toBe(true);
		});
	});

	describe("error on missing _def", () => {
		it("throws SCHEMA_PARSE_FAILED when _def is missing", () => {
			expect(() => extractFromZod({})).toThrow("Schema does not appear to be a Zod schema");
		});
	});

	describe("ZodLiteral", () => {
		it("maps string literal correctly", () => {
			const schema = zodV3Object({
				kind: zodV3("ZodLiteral", { value: "admin" }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "kind", type: "string", required: true });
			expect(result.fields[0].metadata?.const).toBe("admin");
		});

		it("maps number literal correctly", () => {
			const schema = zodV3Object({
				code: zodV3("ZodLiteral", { value: 42 }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0].type).toBe("number");
			expect(result.fields[0].metadata?.const).toBe(42);
		});
	});

	describe("ZodBigInt", () => {
		it("maps to integer type", () => {
			const schema = zodV3Object({
				bigId: zodV3("ZodBigInt"),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]).toMatchObject({ path: "bigId", type: "integer", required: true });
		});
	});

	describe("metadata", () => {
		it("returns vendor as zod", () => {
			const schema = zodV3Object({ name: zodV3("ZodString") });
			const result = extractFromZod(schema);
			expect(result.metadata.vendor).toBe("zod");
		});
	});

	describe("vendor extensions", () => {
		it("extracts formbar object from .meta() into extensions.formbar", () => {
			const schema = zodV3Object({
				age: zodV3("ZodNumber", { metadata: { formbar: { widget: "slider" } } }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]?.metadata?.extensions).toEqual({ formbar: { widget: "slider" } });
		});

		it("extracts tanstack object from .meta() into extensions.tanstack", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString", { metadata: { tanstack: { sortable: true } } }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]?.metadata?.extensions).toEqual({ tanstack: { sortable: true } });
		});

		it("extracts multiple vendor keys", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString", {
					metadata: { formbar: { widget: "input" }, tanstack: { filterable: true } },
				}),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]?.metadata?.extensions).toEqual({
				formbar: { widget: "input" },
				tanstack: { filterable: true },
			});
		});

		it("ignores top-level non-object metadata values", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString", { metadata: { label: "Name", count: 42 } }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]?.metadata?.extensions).toBeUndefined();
		});

		it("does not throw on x-vendor keys in meta", () => {
			const schema = zodV3Object({
				name: zodV3("ZodString", { metadata: { "x-custom": { foo: "bar" } } }),
			});
			const result = extractFromZod(schema);
			expect(result.fields[0]?.metadata?.extensions).toEqual({ "x-custom": { foo: "bar" } });
		});
	});
});

describe("extractFromZodV4", () => {
	it("does not evaluate ordinary leaf metadata for a root schema", () => {
		let metadataReads = 0;
		const def = {
			type: "string",
			get metadata() {
				metadataReads += 1;
				return { formbar: { widget: "text" } };
			},
		};

		expect(extractFromZodV4({ _zod: { def } })).toEqual({ fields: [], metadata: { vendor: "zod4" } });
		expect(metadataReads).toBe(0);
	});

	it("preserves a function returned by a default accessor without invoking it", () => {
		let accessorReads = 0;
		let functionCalls = 0;
		const defaultFunction = () => {
			functionCalls += 1;
		};
		const defaultDef = {
			type: "default",
			innerType: zodV4("literal", { value: "function" }),
			get defaultValue() {
				accessorReads += 1;
				return defaultFunction;
			},
		};
		const result = extractFromZodV4(zodV4Object({ value: { _zod: { def: defaultDef } } }));

		expect(result.fields[0]?.defaultValue).toBe(defaultFunction);
		expect(accessorReads).toBe(1);
		expect(functionCalls).toBe(0);
	});

	it("supports callable data defaults and the nativeEnum values compatibility branch", () => {
		let defaultCalls = 0;
		const nativeEnum = zodV4("nativeEnum", { values: { One: "one", Two: "two" } });
		const field = zodV4("default", {
			innerType: nativeEnum,
			defaultValue: () => {
				defaultCalls += 1;
				return "one";
			},
		});
		const result = extractFromZodV4(zodV4Object({ value: field }));

		expect(result.fields[0]).toMatchObject({
			path: "value",
			type: "enum",
			required: false,
			defaultValue: "one",
			metadata: { enum: ["one", "two"] },
		});
		expect(defaultCalls).toBe(1);
	});

	it("omits explicit undefined defaults", () => {
		const field = zodV4("default", { innerType: zodV4("literal", { value: "fixed" }), defaultValue: undefined });
		const result = extractFromZodV4(zodV4Object({ value: field }));

		expect(result.fields[0]).not.toHaveProperty("defaultValue");
	});
});
