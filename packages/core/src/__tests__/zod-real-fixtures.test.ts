import { describe, expect, it } from "vitest";
import { z as z3 } from "zod3";
import { z as z4 } from "zod4";
import { extractFromZod } from "../adapters/zod-extractor.js";
import { extractFromZodV4 } from "../adapters/zod4-extractor.js";

describe("real Zod v3 fixtures", () => {
	it("extracts enum and native enum values exactly", () => {
		const Native = { 1: "One", 2: "Two", One: 1, Two: 2, Other: "other" } as const;
		const result = extractFromZod(z3.object({ status: z3.enum(["new", "done"]), code: z3.nativeEnum(Native) }));

		expect(result.fields).toMatchObject([
			{ path: "status", type: "enum", metadata: { enum: ["new", "done"] } },
			{ path: "code", type: "enum", metadata: { enum: [1, 2, "other"] } },
		]);
	});

	it("does not classify union options as enum values", () => {
		const result = extractFromZod(z3.object({ value: z3.union([z3.literal("yes"), z3.literal(1)]) }));

		expect(result.fields[0]).toMatchObject({ path: "value", type: "union" });
		expect(result.fields[0]?.metadata?.enum).toBeUndefined();
	});

	it("merges metadata carried by wrappers and inner schemas", () => {
		const inner = z3.string() as z3.ZodString & { _def: { metadata?: unknown } };
		inner._def.metadata = { custom: { inner: true, winner: "inner" }, list: ["inner"] };
		const field = inner.optional() as z3.ZodOptional<z3.ZodString> & { _def: { metadata?: unknown } };
		field._def.metadata = { custom: { outer: true, winner: "outer" }, list: ["outer"] };
		const result = extractFromZod(z3.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toEqual({
			custom: { inner: true, outer: true, winner: "outer" },
			list: ["outer"],
		});
	});

	it.each([
		["nullable", (schema: z3.ZodString) => schema.nullable()],
		["default", (schema: z3.ZodString) => schema.default("fallback")],
		["effects", (schema: z3.ZodString) => schema.transform((value) => value)],
		["pipeline", (schema: z3.ZodString) => schema.pipe(z3.string())],
	])("preserves metadata through the %s wrapper", (_, wrap) => {
		const inner = z3.string() as z3.ZodString & { _def: { metadata?: unknown } };
		inner._def.metadata = { inner: ["retained"] };
		const field = wrap(inner) as ReturnType<typeof wrap> & { _def: { metadata?: unknown } };
		field._def.metadata = { outer: { retained: true } };
		const result = extractFromZod(z3.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toMatchObject({
			inner: ["retained"],
			outer: { retained: true },
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
	it("extracts current entries values with primitive type and order intact", () => {
		const result = extractFromZodV4(z4.object({ status: z4.enum({ First: "first", Answer: 42 }) }));

		expect(result.fields[0]).toMatchObject({
			path: "status",
			type: "enum",
			metadata: { enum: ["first", 42] },
		});
	});

	it("preserves arbitrary registry metadata without interpreting namespaced data", () => {
		const options = [{ label: "Enabled", value: "enabled", disabled: true }];
		const field = z4.enum(["enabled", "disabled"]).meta({
			title: "State",
			custom: ["one", { nested: true }],
			formbar: { options, translationId: "state" },
		});
		const result = extractFromZodV4(z4.object({ state: field }));

		expect(result.fields[0]?.metadata).toMatchObject({
			title: "State",
			enum: ["enabled", "disabled"],
			extensions: {
				custom: ["one", { nested: true }],
				formbar: { options, translationId: "state" },
			},
		});
		expect(result.fields[0]?.metadata?.enum).not.toEqual(options);
	});

	it("reads metadata from a custom Zod registry", () => {
		const registry = z4.registry<Record<string, unknown>>();
		const field = z4.string().register(registry, { custom: ["registry", { retained: true }] });
		const registered = registry.get(field);
		const result = extractFromZodV4(z4.object({ field: field.meta(registered) }));

		expect(result.fields[0]?.metadata?.extensions).toEqual(registered);
	});

	it("merges wrapper and inner metadata with outer precedence and atomic arrays", () => {
		const inner = z4.string().meta({ shared: { inner: true, winner: "inner" }, list: ["inner"] });
		const field = inner.optional().meta({ shared: { outer: true, winner: "outer" }, list: ["outer"] });
		const result = extractFromZodV4(z4.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toEqual({
			shared: { inner: true, outer: true, winner: "outer" },
			list: ["outer"],
		});
	});

	it.each([
		["nullable", (schema: z4.ZodString) => schema.nullable()],
		["default", (schema: z4.ZodString) => schema.default("fallback")],
		["readonly", (schema: z4.ZodString) => schema.readonly()],
		["catch", (schema: z4.ZodString) => schema.catch("fallback")],
		["pipe", (schema: z4.ZodString) => schema.pipe(z4.string())],
	])("preserves metadata through the %s wrapper", (_, wrap) => {
		const field = wrap(z4.string().meta({ inner: { retained: true } })).meta({ outer: ["retained"] });
		const result = extractFromZodV4(z4.object({ value: field }));

		expect(result.fields[0]?.metadata?.extensions).toMatchObject({
			inner: { retained: true },
			outer: ["retained"],
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
