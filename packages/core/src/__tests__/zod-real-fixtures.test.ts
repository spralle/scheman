import { describe, expect, it } from "vitest";
import { z as z3 } from "zod3";
import { z as z4 } from "zod4";
import { extractFromZod } from "../adapters/zod-extractor.js";
import { extractFromZodV4 } from "../adapters/zod4-extractor.js";
import type { SchemaFieldMetadata } from "../types.js";

describe("real Zod v3 fixtures", () => {
	it("extracts enum and native enum values exactly", () => {
		const Native = { 1: "One", 2: "Two", One: 1, Two: 2, Other: "other" } as const;
		const result = extractFromZod(z3.object({ status: z3.enum(["new", "done"]), code: z3.nativeEnum(Native) }));

		expect(result.fields).toMatchObject([
			{ path: "status", type: "enum", metadata: { enum: ["new", "done"] } },
			{ path: "code", type: "enum", metadata: { enum: [1, 2, "other"] } },
		]);
		expect(result.fields[1]?.metadata?.enum).toEqual(
			acceptedValues(z3.nativeEnum(Native), ["One", "Two", 1, 2, "other"]),
		);
	});

	it("does not classify union options as enum values", () => {
		const result = extractFromZod(z3.object({ value: z3.union([z3.literal("yes"), z3.literal(1)]) }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "union" });
		expect(result.fields[0]?.metadata?.enum).toBeUndefined();
	});

	it("merges metadata carried by wrappers and inner schemas", () => {
		const inner = z3.string() as z3.ZodString & { _def: { metadata?: unknown } };
		inner._def.metadata = { custom: { inner: true, winner: "inner" }, list: { values: ["inner"] } };
		const field = inner.optional() as z3.ZodOptional<z3.ZodString> & { _def: { metadata?: unknown } };
		field._def.metadata = { custom: { outer: true, winner: "outer" }, list: { values: ["outer"] } };
		const result = extractFromZod(z3.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toEqual({
			custom: { inner: true, outer: true, winner: "outer" },
			list: { values: ["outer"] },
		});
	});

	it.each([
		["nullable", (schema: z3.ZodString) => schema.nullable()],
		["default", (schema: z3.ZodString) => schema.default("fallback")],
		["effects", (schema: z3.ZodString) => schema.transform((value) => value)],
		["pipeline", (schema: z3.ZodString) => schema.pipe(z3.string())],
	])("preserves metadata through the %s wrapper", (_, wrap) => {
		const inner = z3.string() as z3.ZodString & { _def: { metadata?: unknown } };
		inner._def.metadata = { inner: { values: ["retained"] } };
		const field = wrap(inner) as ReturnType<typeof wrap> & { _def: { metadata?: unknown } };
		field._def.metadata = { outer: { retained: true } };
		const result = extractFromZod(z3.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toMatchObject({
			inner: { values: ["retained"] },
			outer: { retained: true },
		});
	});

	it("merges pipeline output, input, pipeline, and outer metadata in field-input precedence order", () => {
		const output = withV3Metadata(z3.string(), { shared: { output: true, winner: "output" } });
		const input = withV3Metadata(z3.string(), { shared: { input: true, winner: "input" } });
		const pipeline = withV3Metadata(input.pipe(output), { shared: { pipeline: true, winner: "pipeline" } });
		const field = withV3Metadata(pipeline.optional(), { shared: { outer: true, winner: "outer" } });
		const result = extractFromZod(z3.object({ value: field }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "string", required: false });
		expect(result.fields[0]?.metadata?.extensions).toEqual({
			shared: { output: true, input: true, pipeline: true, outer: true, winner: "outer" },
		});
	});

	it("extracts a reused schema at each path and terminates lazy cycles", () => {
		const shared = z3.string();
		interface Node {
			name: string;
			child?: Node;
		}
		const node: z3.ZodType<Node> = z3.lazy(() => z3.object({ name: shared, child: node.optional() }));
		const result = extractFromZod(z3.object({ first: shared, second: shared, tree: node }));

		expect(result.fields.map(({ path }) => path)).toEqual(["first", "second", "tree.name"]);
	});
});

describe("real Zod v4 fixtures", () => {
	it("preserves every accepted primitive and entry order for ambiguous enum entries", () => {
		const entries = { One: "A", A: 1 } as const;
		const enumSchema = z4.enum(entries);
		const nativeSchema = z4.nativeEnum(entries);
		const result = extractFromZodV4(z4.object({ enumValue: enumSchema, nativeValue: nativeSchema }));

		expect(result.fields.map((field) => field.metadata?.enum)).toEqual([
			["A", 1],
			["A", 1],
		]);
		expect(result.fields[0]?.metadata?.enum).toEqual(acceptedValues(enumSchema, ["One", "A", 1]));
		expect(result.fields[1]?.metadata?.enum).toEqual(acceptedValues(nativeSchema, ["One", "A", 1]));
	});

	it("filters numeric reverse entries while preserving heterogeneous enum values", () => {
		const Native = { 1: "One", 2: "Two", One: 1, Two: 2, Other: "other" } as const;
		const enumSchema = z4.enum(Native);
		const nativeSchema = z4.nativeEnum(Native);
		const result = extractFromZodV4(z4.object({ enumValue: enumSchema, nativeValue: nativeSchema }));

		expect(result.fields.map((field) => field.metadata?.enum)).toEqual([
			[1, 2, "other"],
			[1, 2, "other"],
		]);
		expect(result.fields[0]?.metadata?.enum).toEqual(acceptedValues(enumSchema, ["One", "Two", 1, 2, "other"]));
		expect(result.fields[1]?.metadata?.enum).toEqual(acceptedValues(nativeSchema, ["One", "Two", 1, 2, "other"]));
	});

	it("preserves object-valued registry metadata without interpreting namespaced data", () => {
		const options = [{ label: "Enabled", value: "enabled", disabled: true }];
		const compatibleExtensions: NonNullable<SchemaFieldMetadata["extensions"]> = { formbar: { options } };
		const field = z4.enum(["enabled", "disabled"]).meta({
			title: "State",
			formbar: { options, translationId: "state" },
		});
		const result = extractFromZodV4(z4.object({ state: field }));

		expect(result.fields[0]?.metadata).toMatchObject({
			title: "State",
			enum: ["enabled", "disabled"],
			extensions: {
				formbar: { options, translationId: "state" },
			},
		});
		expect(result.fields[0]?.metadata?.enum).not.toEqual(options);
		expect(compatibleExtensions.formbar?.options).toBe(options);
	});

	it("preserves custom-registry data after it is copied into global metadata", () => {
		const registry = z4.registry<Record<string, unknown>>();
		const field = z4.string().register(registry, { custom: { registry: true, retained: true } });
		const registered = registry.get(field);
		const result = extractFromZodV4(z4.object({ field: field.meta(registered) }));

		expect(result.fields[0]?.metadata?.extensions).toEqual(registered);
	});

	it("merges wrapper and inner metadata with outer precedence and atomic arrays", () => {
		const inner = z4.string().meta({ shared: { inner: true, winner: "inner" }, list: { values: ["inner"] } });
		const field = inner.optional().meta({ shared: { outer: true, winner: "outer" }, list: { values: ["outer"] } });
		const result = extractFromZodV4(z4.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toEqual({
			shared: { inner: true, outer: true, winner: "outer" },
			list: { values: ["outer"] },
		});
	});

	it.each([
		["nullable", (schema: z4.ZodString) => schema.nullable()],
		["default", (schema: z4.ZodString) => schema.default("fallback")],
		["readonly", (schema: z4.ZodString) => schema.readonly()],
		["catch", (schema: z4.ZodString) => schema.catch("fallback")],
		["pipe", (schema: z4.ZodString) => schema.pipe(z4.string())],
	])("preserves metadata through the %s wrapper", (_, wrap) => {
		const field = wrap(z4.string().meta({ inner: { retained: true } })).meta({ outer: { values: ["retained"] } });
		const result = extractFromZodV4(z4.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toMatchObject({
			inner: { retained: true },
			outer: { values: ["retained"] },
		});
	});

	it("merges pipe output, input, pipe, and outer metadata in field-input precedence order", () => {
		const output = z4.string().meta({ shared: { output: true, winner: "output" } });
		const input = z4.string().meta({ shared: { input: true, winner: "input" } });
		const field = input
			.pipe(output)
			.meta({ shared: { pipeline: true, winner: "pipeline" } })
			.optional()
			.meta({ shared: { outer: true, winner: "outer" } });
		const result = extractFromZodV4(z4.object({ value: field }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "string", required: false });
		expect(result.fields[0]?.metadata?.extensions).toEqual({
			shared: { output: true, input: true, pipeline: true, outer: true, winner: "outer" },
		});
	});

	it("extracts reused schemas independently and terminates recursive graphs", () => {
		const shared = z4.string();
		interface Node {
			name: string;
			child?: Node;
		}
		const node: z4.ZodType<Node> = z4.lazy(() => z4.object({ name: shared, child: node.optional() }));
		const result = extractFromZodV4(z4.object({ first: shared, second: shared, tree: node }));

		expect(result.fields.map(({ path }) => path)).toEqual(["first", "second", "tree.name"]);
	});

	it("never treats union options as enum metadata", () => {
		const result = extractFromZodV4(z4.object({ value: z4.union([z4.literal("yes"), z4.literal(1)]) }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "union" });
		expect(result.fields[0]?.metadata?.enum).toBeUndefined();
	});
});

function acceptedValues(
	schema: { safeParse(value: unknown): { success: boolean } },
	candidates: readonly unknown[],
): unknown[] {
	return candidates.filter((value) => schema.safeParse(value).success);
}

function withV3Metadata<T extends z3.ZodTypeAny>(schema: T, metadata: Readonly<Record<string, unknown>>): T {
	(schema._def as z3.ZodTypeDef & { metadata?: unknown }).metadata = metadata;
	return schema;
}
