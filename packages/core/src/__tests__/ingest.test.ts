import { afterEach, describe, expect, it } from "vitest";
import { clearExtractorRegistry, registerExtractor } from "../extractor-registry.js";
import { ingestSchema } from "../ingest.js";

afterEach(() => {
	clearExtractorRegistry();
});

describe("ingestSchema", () => {
	it("dispatches to JSON Schema extractor for objects with type + properties", () => {
		const schema = {
			type: "object",
			properties: { name: { type: "string" } },
			required: ["name"],
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [{ path: "name", type: "string", required: true }],
			metadata: { vendor: "json-schema" },
		});
	});

	it("dispatches to JSON Schema extractor for objects with $schema", () => {
		const schema = {
			$schema: "http://json-schema.org/draft-07/schema#",
			type: "object",
			properties: { age: { type: "number" } },
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [{ path: "age", type: "number", required: false }],
			metadata: { vendor: "json-schema" },
		});
	});

	it("dispatches to Zod v3 for StandardSchema with vendor 'zod' and _def.typeName", () => {
		const schema = {
			"~standard": { version: 1, vendor: "zod", validate: () => ({ value: {} }) },
			_def: {
				typeName: "ZodObject",
				shape: () => ({
					name: {
						"~standard": { version: 1, vendor: "zod", validate: () => ({ value: "" }) },
						_def: { typeName: "ZodString" },
					},
				}),
			},
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [{ path: "name", type: "string", required: true }],
			metadata: { vendor: "zod" },
		});
	});

	it("dispatches to Zod v4 for StandardSchema with vendor 'zod' and _zod property", () => {
		const schema = {
			"~standard": { version: 1, vendor: "zod", validate: () => ({ value: {} }) },
			_zod: {
				def: {
					type: "object",
					shape: {
						name: {
							"~standard": { version: 1, vendor: "zod", validate: () => ({ value: "" }) },
							_zod: { def: { type: "string" } },
						},
					},
				},
			},
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [{ path: "name", type: "string", required: true }],
			metadata: { vendor: "zod4" },
		});
	});

	it("returns validationOnly result for unknown StandardSchema vendors", () => {
		const schema = {
			"~standard": { version: 1, vendor: "valibot", validate: () => ({ value: {} }) },
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [],
			metadata: { validationOnly: true, vendor: "valibot" },
		});
	});

	it("uses registered extractor when one matches", () => {
		registerExtractor({
			vendor: "custom",
			canExtract: (s: unknown) => (s as Record<string, Record<string, string>>)?.["~standard"]?.vendor === "custom",
			extract: () => [{ name: "field1", type: "string", required: true }],
		});
		const schema = {
			"~standard": { version: 1, vendor: "custom", validate: () => ({ value: {} }) },
		};
		const result = ingestSchema(schema);
		expect(result.fields).toHaveLength(1);
		expect(result.fields[0].name).toBe("field1");
		expect(result.metadata?.vendor).toBe("custom");
	});

	it("throws SCHEMA_UNSUPPORTED for non-schema input", () => {
		expect(() => ingestSchema("hello")).toThrow("Schema does not conform");
		expect(() => ingestSchema(42)).toThrow("Schema does not conform");
		expect(() => ingestSchema(null)).toThrow("Schema does not conform");
		expect(() => ingestSchema({ random: "object" })).toThrow("Schema does not conform");
	});

	it("handles nested object JSON Schema with multiple field types", () => {
		const schema = {
			type: "object",
			properties: {
				user: {
					type: "object",
					properties: {
						name: { type: "string", minLength: 1 },
						age: { type: "integer", minimum: 0 },
						active: { type: "boolean" },
					},
					required: ["name"],
				},
			},
			required: ["user"],
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [
				{ path: "user.name", type: "string", required: true, metadata: { minLength: 1 } },
				{ path: "user.age", type: "integer", required: false, metadata: { minimum: 0 } },
				{ path: "user.active", type: "boolean", required: false },
			],
			metadata: { vendor: "json-schema" },
		});
	});

	it("handles JSON Schema with enum, format, and default values", () => {
		const schema = {
			type: "object",
			properties: {
				email: { type: "string", format: "email", title: "Email Address" },
				role: { type: "string", enum: ["admin", "user", "guest"], default: "user" },
				score: { type: "number", minimum: 0, maximum: 100 },
			},
			required: ["email", "role"],
		};
		const result = ingestSchema(schema);
		expect(result).toEqual({
			fields: [
				{
					path: "email",
					type: "string",
					required: true,
					metadata: { format: "email", title: "Email Address" },
				},
				{
					path: "role",
					type: "enum",
					required: true,
					defaultValue: "user",
					metadata: { enum: ["admin", "user", "guest"], default: "user" },
				},
				{
					path: "score",
					type: "number",
					required: false,
					metadata: { minimum: 0, maximum: 100 },
				},
			],
			metadata: { vendor: "json-schema" },
		});
	});
});
