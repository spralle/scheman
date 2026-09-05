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

	it("merges lazy pipeline output, input, pipeline, and outer metadata in field-input precedence order", () => {
		const outputLeaf = withV3Metadata(z3.string(), {
			shared: {
				outputLeaf: true,
				lazyWinner: "output-leaf",
				inputWinner: "output-leaf",
				pipelineWinner: "output-leaf",
				outerWinner: "output-leaf",
			},
		});
		const output = withV3Metadata(
			z3.lazy(() => outputLeaf),
			{
				shared: {
					outputLazy: true,
					lazyWinner: "output-lazy",
					inputWinner: "output-lazy",
					pipelineWinner: "output-lazy",
					outerWinner: "output-lazy",
				},
			},
		);
		const input = withV3Metadata(z3.string(), {
			shared: { input: true, inputWinner: "input", pipelineWinner: "input", outerWinner: "input" },
		});
		const pipeline = withV3Metadata(input.pipe(output), {
			shared: { pipeline: true, pipelineWinner: "pipeline", outerWinner: "pipeline" },
		});
		const field = withV3Metadata(pipeline.optional(), { shared: { outer: true, outerWinner: "outer" } });
		const result = extractFromZod(z3.object({ value: field }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "string", required: false });
		expect(result.fields[0]?.metadata?.extensions).toEqual({
			shared: {
				outputLeaf: true,
				outputLazy: true,
				input: true,
				pipeline: true,
				outer: true,
				lazyWinner: "output-lazy",
				inputWinner: "input",
				pipelineWinner: "pipeline",
				outerWinner: "outer",
			},
		});
	});

	it("terminates when a pipeline output lazy resolves back to the pipeline", () => {
		const input = withV3Metadata(z3.string(), { input: { retained: true } });
		const cycle: { pipeline?: z3.ZodTypeAny } = {};
		const output = withV3Metadata(
			z3.lazy(() => cycle.pipeline as z3.ZodTypeAny),
			{ lazy: { retained: true } },
		);
		const pipeline = withV3Metadata(input.pipe(output), { pipeline: { retained: true } });
		cycle.pipeline = pipeline;
		const result = extractFromZod(z3.object({ value: pipeline }));

		expect(result.fields).toHaveLength(1);
		expect(result.fields[0]).toMatchObject({ path: "value", type: "string" });
		expect(result.fields[0]?.metadata?.extensions).toMatchObject({
			input: { retained: true },
			lazy: { retained: true },
			pipeline: { retained: true },
		});
	});

	it("preserves defaults on every special leaf", () => {
		const Native = { One: "one", Two: "two" } as const;
		const result = extractFromZod(
			z3.object({
				literal: z3.literal("fixed").default("fixed"),
				nativeEnum: z3.nativeEnum(Native).default(Native.One),
				record: z3.record(z3.string()).default({ saved: "yes" }),
				tuple: z3.tuple([z3.string()]).default(["saved"]),
				bigint: z3.bigint().default(7n),
			}),
		);

		expect(result.fields.map((field) => field.defaultValue)).toEqual(["fixed", "one", { saved: "yes" }, ["saved"], 7n]);
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

	it("merges lazy pipe output, input, pipe, and outer metadata in field-input precedence order", () => {
		const outputLeaf = z4.string().meta({
			shared: {
				outputLeaf: true,
				lazyWinner: "output-leaf",
				inputWinner: "output-leaf",
				pipelineWinner: "output-leaf",
				outerWinner: "output-leaf",
			},
		});
		const output = z4
			.lazy(() => outputLeaf)
			.meta({
				shared: {
					outputLazy: true,
					lazyWinner: "output-lazy",
					inputWinner: "output-lazy",
					pipelineWinner: "output-lazy",
					outerWinner: "output-lazy",
				},
			});
		const input = z4.string().meta({
			shared: { input: true, inputWinner: "input", pipelineWinner: "input", outerWinner: "input" },
		});
		const field = input
			.pipe(output)
			.meta({ shared: { pipeline: true, pipelineWinner: "pipeline", outerWinner: "pipeline" } })
			.optional()
			.meta({ shared: { outer: true, outerWinner: "outer" } });
		const result = extractFromZodV4(z4.object({ value: field }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "string", required: false });
		expect(result.fields[0]?.metadata?.extensions).toEqual({
			shared: {
				outputLeaf: true,
				outputLazy: true,
				input: true,
				pipeline: true,
				outer: true,
				lazyWinner: "output-lazy",
				inputWinner: "input",
				pipelineWinner: "pipeline",
				outerWinner: "outer",
			},
		});
	});

	it("terminates when a pipe output lazy resolves back to the pipe", () => {
		const input = z4.string().meta({ input: { retained: true } });
		const cycle: { pipeline?: z4.ZodType } = {};
		const output = z4.lazy(() => cycle.pipeline as z4.ZodType).meta({ lazy: { retained: true } });
		const pipeline = input.pipe(output).meta({ pipeline: { retained: true } });
		cycle.pipeline = pipeline;
		const result = extractFromZodV4(z4.object({ value: pipeline }));

		expect(result.fields).toHaveLength(1);
		expect(result.fields[0]).toMatchObject({ path: "value", type: "string" });
		expect(result.fields[0]?.metadata?.extensions).toMatchObject({
			input: { retained: true },
			lazy: { retained: true },
			pipeline: { retained: true },
		});
	});

	it("resolves scalar and callable defaults once and preserves function values", () => {
		let stringFactoryCalls = 0;
		let functionFactoryCalls = 0;
		const functionDefault = () => "saved";
		const result = extractFromZodV4(
			z4.object({
				scalar: z4.string().default("fixed"),
				callable: z4.string().default(() => {
					stringFactoryCalls += 1;
					return "generated";
				}),
				functionValue: z4.function().default(() => {
					functionFactoryCalls += 1;
					return functionDefault;
				}),
			}),
		);

		expect(result.fields.map((field) => field.defaultValue)).toEqual(["fixed", "generated", functionDefault]);
		expect(stringFactoryCalls).toBe(1);
		expect(functionFactoryCalls).toBe(1);
	});

	it("preserves defaults on every special leaf", () => {
		const Native = { One: "one", Two: "two" } as const;
		const result = extractFromZodV4(
			z4.object({
				literal: z4.literal("fixed").default("fixed"),
				nativeEnum: z4.nativeEnum(Native).default(Native.One),
				record: z4.record(z4.string(), z4.string()).default({ saved: "yes" }),
				tuple: z4.tuple([z4.string()]).default(["saved"]),
			}),
		);

		expect(result.fields.map((field) => field.defaultValue)).toEqual(["fixed", "one", { saved: "yes" }, ["saved"]]);
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
