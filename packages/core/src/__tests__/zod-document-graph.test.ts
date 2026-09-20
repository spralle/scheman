import { describe, expect, it } from "vitest";
import { z as z3 } from "zod3";
import { z as z3min } from "zod3-min";
import { z as z4 } from "zod4";
import { z as z4min } from "zod4-min";
import type { SchemaNode } from "../document/nodes.js";
import type { NodeRef, SchemaDocument, Side } from "../document/types.js";
import { ingestSchemaDocument } from "../ingest-document.js";
import { zod3Provider } from "../providers/zod3/index.js";
import { zod4Provider } from "../providers/zod4/index.js";

const execution = { shape: "allow", lazy: "allow", metadata: "allow" } as const;
const matrix = [
	{ name: "3.24.0", z: z3min as typeof z3, provider: zod3Provider, version: 3 },
	{ name: "3.25.76", z: z3, provider: zod3Provider, version: 3 },
	{ name: "4.0.0", z: z4min as unknown as typeof z3, provider: zod4Provider, version: 4 },
	{ name: "4.1.5", z: z4 as unknown as typeof z3, provider: zod4Provider, version: 4 },
];
function node(document: SchemaDocument, ref: NodeRef): SchemaNode {
	return document.nodes[ref.nodeId];
}
function root(document: SchemaDocument, side: Side = "input") {
	return node(document, document.root[side]);
}
function unwrap(document: SchemaDocument, side: Side) {
	let result = root(document, side);
	while (result.kind === "wrapper") result = node(document, result.inner);
	return result;
}

describe.each(matrix)("Zod $name recursive document graph", ({ z, provider, version }) => {
	const ingest = (source: unknown) => ingestSchemaDocument(source, { provider: provider({ execution }) }).document;
	it("supports primitive roots without validation and serializes JS literals", () => {
		for (const [schema, type] of [
			[z.string(), "string"],
			[z.number(), "number"],
			[z.bigint(), "bigint"],
			[z.date(), "date"],
			[z.nan(), "NaN"],
			[z.symbol(), "symbol"],
			[z.undefined(), "undefined"],
			[z.void(), "void"],
			[z.null(), "null"],
			[z.boolean(), "boolean"],
		] as const) {
			expect(root(ingest(schema))).toMatchObject({ kind: "primitive", type });
		}
		expect(root(ingest(z.any()))).toMatchObject({ kind: "unconstrained", domain: "js" });
		expect(root(ingest(z.never()))).toMatchObject({ kind: "never" });
		expect(root(ingest(z.literal("hello")))).toMatchObject({ kind: "literal", value: "hello" });
		expect(() => JSON.stringify(ingest(z.literal(123n)))).not.toThrow();
	});
	it("keeps local presence, exact property names and shared identity", () => {
		const shared = z.string();
		const shape = Object.create(null);
		Object.assign(shape, {
			"a.b": shared,
			constructor: shared,
			parent: z.object({ required: z.number() }).optional(),
			d: z.string().default("x"),
		});
		Object.defineProperty(shape, "__proto__", { value: shared, enumerable: true });
		const document = ingest(z.object(shape));
		const object = root(document);
		expect(object.kind).toBe("object");
		if (object.kind !== "object") return;
		expect(object.properties.map((p) => p.name)).toEqual(["a.b", "constructor", "parent", "d", "__proto__"]);
		expect(object.properties[0].node).toEqual(object.properties[1].node);
		expect(object.properties[2].presence).toBe("optional");
		expect(object.properties[3].presence).toBe("optional");
		const parent = node(document, object.properties[2].node);
		if (parent.kind !== "wrapper") throw new Error("missing optional wrapper");
		expect(node(document, parent.inner)).toMatchObject({ kind: "object", required: ["required"] });
		expect(document.root.input).not.toEqual(document.root.output);
	});
	it("keeps array items, tuple rest, record keys and enum exhaustiveness", () => {
		const document = ingest(
			z.tuple([z.array(z.object({ x: z.string() })), z.record(z.enum(["a", "b"]), z.number())]).rest(z.boolean()),
		);
		const tuple = root(document);
		if (tuple.kind !== "tuple") throw new Error("missing tuple");
		expect(tuple.items).toHaveLength(2);
		if (!tuple.rest) throw new Error("missing tuple rest");
		expect(node(document, tuple.rest)).toMatchObject({ kind: "primitive", type: "boolean" });
		const array = node(document, tuple.items[0]);
		if (array.kind !== "array") throw new Error("missing array");
		expect(node(document, array.items).kind).toBe("object");
		const record = node(document, tuple.items[1]);
		if (record.kind !== "record") throw new Error("missing record");
		expect(record.exhaustive).toBe(version === 4);
		expect(node(document, record.key)).toMatchObject({ kind: "enum", values: ["a", "b"] });
		expect(node(document, record.value)).toMatchObject({ kind: "primitive", type: "number" });
	});
	it("computes known presence independently on both sides without default factories", () => {
		const document = ingest(
			z.object({
				plain: z.union([z.string(), z.number()]),
				optionalUnion: z.union([z.string().optional(), z.number()]),
				defaulted: z.string().default("x"),
				preprocessed: z.preprocess((x) => x, z.string()),
				anything: z.any(),
			}),
		);
		const input = root(document);
		const output = root(document, "output");
		if (input.kind !== "object" || output.kind !== "object") throw new Error("missing objects");
		expect(input.properties.map((p) => p.presence)).toEqual([
			"required",
			"optional",
			"optional",
			"unknown",
			"optional",
		]);
		expect(output.properties.map((p) => p.presence)).toEqual([
			"required",
			"optional",
			version === 3 ? "required" : "unknown",
			"required",
			"optional",
		]);
	});
	it("preserves native enum values and ordered union/intersection operands", () => {
		const native = { 0: "A", 1: "B", A: 0, B: 1, C: "c" };
		expect(root(ingest(z.nativeEnum(native)))).toMatchObject({ kind: "enum", values: [0, 1, "c"] });
		const union = root(ingest(z.union([z.string(), z.number()])));
		expect(union).toMatchObject({ kind: "union", semantics: "zod" });
		const discriminated = root(
			ingest(z.discriminatedUnion("type", [z.object({ type: z.literal("a") }), z.object({ type: z.literal("b") })])),
		);
		expect(discriminated).toMatchObject({ kind: "union", discriminator: "type" });
		expect(root(ingest(z.intersection(z.object({ a: z.string() }), z.object({ b: z.number() }))))).toMatchObject({
			kind: "intersection",
			operands: expect.any(Array),
		});
	});
	it("distinguishes strict, strip, passthrough and typed catchall", () => {
		for (const [schema, unknownKeys] of [
			[z.object({}), "strip"],
			[z.object({}).strict(), "reject"],
			[z.object({}).passthrough(), "passthrough"],
			[z.object({}).catchall(z.number()), "schema"],
		] as const) {
			expect(root(ingest(schema))).toMatchObject({ kind: "object", unknownKeys });
		}
	});
	it("denies lazy execution by default and caches recursion once across both sides", () => {
		let calls = 0;
		const recursive: ReturnType<typeof z.lazy> = z.lazy(() => {
			calls++;
			return z.object({ next: recursive.optional() });
		});
		const denied = ingestSchemaDocument(recursive, { provider: provider() }).document;
		expect(calls).toBe(0);
		expect(root(denied)).toMatchObject({ kind: "ref", unresolved: "zod.lazy-unresolved" });
		const document = ingest(recursive);
		expect(calls).toBe(1);
		const lazy = root(document);
		if (lazy.kind !== "ref" || !lazy.target) throw new Error("missing lazy target");
		const object = node(document, lazy.target);
		if (object.kind !== "object") throw new Error("missing recursive object");
		const optional = node(document, object.properties[0].node);
		expect(optional).toMatchObject({ kind: "wrapper", inner: document.root.input });
		expect(() => JSON.stringify(document)).not.toThrow();
	});
	it("caches shape calls, denies generic shape-property getters", () => {
		let shapes = 0;
		let forbidden = 0;
		const shape = { safe: z.string() };
		Object.defineProperty(shape, "evil", {
			enumerable: true,
			get() {
				forbidden++;
				throw new Error("no");
			},
		});
		const source = z.object({});
		if (version === 3)
			source._def.shape = () => {
				shapes++;
				return shape;
			};
		else
			Object.defineProperty(source._def, "shape", {
				configurable: true,
				get() {
					shapes++;
					return shape;
				},
			});
		const denied = ingestSchemaDocument(source, { provider: provider() }).document;
		expect(root(denied).kind).toBe("unknown");
		expect(shapes).toBe(0);
		const document = ingest(source);
		expect(shapes).toBe(1);
		expect(forbidden).toBe(0);
		expect(JSON.stringify(document)).toContain("evil");
	});
	it("never executes defaults, catches, transforms, preprocessors, refinements or validators", () => {
		let calls = 0;
		const forbidden = () => {
			calls++;
			throw new Error("forbidden");
		};
		const schema = z.object({
			d: z.string().default(forbidden),
			c: z.string().catch(forbidden),
			t: z.string().transform(forbidden),
			p: z.preprocess(forbidden, z.number()),
			r: z.string().refine(forbidden),
		});
		Object.defineProperty(schema, "parse", { value: forbidden });
		const document = ingest(schema);
		expect(calls).toBe(0);
		expect(JSON.stringify(document)).toContain("deferred");
		expect(document.capabilities).toEqual({ input: "partial", output: "partial" });
	});
	it("keeps pipeline known sides and marks transforms/preprocess/coerce unknown", () => {
		const transformed = ingest(z.string().transform(() => 42));
		expect(unwrap(transformed, "input")).toMatchObject({ kind: "primitive", type: "string" });
		expect(unwrap(transformed, "output").kind).toBe("unknown");
		const preprocess = ingest(z.preprocess((x) => x, z.number()));
		expect(unwrap(preprocess, "input").kind).toBe("unknown");
		expect(unwrap(preprocess, "output")).toMatchObject({ kind: "primitive", type: "number" });
		const pipeline = ingest(
			z
				.string()
				.transform(() => 1)
				.pipe(z.number()),
		);
		expect(unwrap(pipeline, "input")).toMatchObject({ kind: "primitive", type: "string" });
		expect(unwrap(pipeline, "output")).toMatchObject({ kind: "primitive", type: "number" });
		const coerced = ingest(z.coerce.number());
		expect(unwrap(coerced, "input").kind).toBe("unknown");
		expect(unwrap(coerced, "output")).toMatchObject({ kind: "primitive", type: "number" });
	});
	it("preserves wrappers, checks and node-local descriptions", () => {
		const schema = z.string().min(2).max(8).email().describe("leaf").nullable().readonly().brand("brand");
		const document = ingest(schema);
		expect(JSON.stringify(document)).toContain("nullable");
		expect(JSON.stringify(document)).toContain("readonly");
		expect(JSON.stringify(document)).toContain("leaf");
		expect(JSON.stringify(document)).toContain("email");
		expect(JSON.stringify(document)).toContain(version === 3 ? '"wrapper":"brand"' : '"wrapper":"readonly"');
		expect(root(ingest(z.array(z.string()).min(2).max(4)))).toHaveProperty("constraints");
	});
	it("retains scalar and collection check evidence without evaluating predicates", () => {
		const number = JSON.stringify(root(ingest(z.number().int().min(2).max(8).multipleOf(2))));
		expect(number).toContain(version === 3 ? '"kind":"int"' : '"format":"safeint"');
		expect(number).toContain('"value":2');
		expect(number).toContain('"value":8');
		const array = JSON.stringify(root(ingest(z.array(z.string()).length(3))));
		expect(array).toContain(version === 3 ? '"value":3' : '"length":3');
		const date = JSON.stringify(root(ingest(z.date().min(new Date(0)))));
		expect(date).toContain('"type":"date"');
		expect(date).toContain(version === 3 ? '"value":0' : '"milliseconds":0');
	});
	it("catches trusted resolver failures without leaking thrown objects", () => {
		let calls = 0;
		const schema = z.lazy(() => {
			calls++;
			throw { secret: "do-not-leak" };
		});
		const document = ingest(schema);
		expect(calls).toBe(1);
		expect(document.diagnostics.some((d) => d.code === "zod.execution.lazy.failed")).toBe(true);
		expect(JSON.stringify(document)).not.toContain("do-not-leak");
	});
	it("uses bounded kernel traversal and deterministic IDs", () => {
		const schema = z.object({ x: z.array(z.object({ y: z.string() })) });
		expect(ingest(schema)).toEqual(ingest(schema));
		const document = ingestSchemaDocument(schema, {
			provider: provider({ execution }),
			limits: { maxNodes: 4, maxDepth: 2 },
		}).document;
		expect(Object.keys(document.nodes).length).toBeLessThanOrEqual(4);
		expect(document.diagnostics.length).toBeGreaterThan(0);
		expect(() => JSON.stringify(document)).not.toThrow();
	});
});

describe.each([
	{ z: z4min, name: "4.0.0" },
	{ z: z4, name: "4.1.5" },
])("Zod $name metadata policies", ({ z, name }) => {
	it("reads metadata once per identity only by explicit permission and owns exact extension values", () => {
		const extension = { a: [1, 2] };
		const leaf = z.string().meta({ description: "leaf", "x-ui": extension, scalar: false });
		let calls = 0;
		const original = leaf.meta;
		leaf.meta = function (...args: Parameters<typeof original>) {
			calls++;
			return original.apply(this, args);
		} as typeof original;
		const schema = z.object({ a: leaf, b: leaf });
		const denied = ingestSchemaDocument(schema, { provider: zod4Provider({ execution: { shape: "allow" } }) }).document;
		expect(calls).toBe(0);
		expect(JSON.stringify(denied)).not.toContain("x-ui");
		const document = ingestSchemaDocument(schema, { provider: zod4Provider({ execution }) }).document;
		expect(calls).toBe(1);
		expect(JSON.stringify(document)).toContain('"x-ui":{"a":[1,2]}');
		extension.a.push(3);
		expect(JSON.stringify(document)).not.toContain("1,2,3");
		expect(Object.isFrozen(extension)).toBe(false);
	});
	it("distinguishes partial enum-key records and multi-value literals", () => {
		const source = z.partialRecord(z.enum(["a", "b"]), z.string());
		const document = ingestSchemaDocument(source, { provider: zod4Provider({ execution }) }).document;
		expect(root(document)).toMatchObject({ kind: "record", exhaustive: name === "4.0.0" ? "unknown" : false });
		const literal = ingestSchemaDocument(z.literal(["a", "b"]), { provider: zod4Provider({ execution }) }).document;
		expect(root(literal)).toMatchObject({ kind: "enum", values: ["a", "b"] });
	});
	it("never invokes the v4 default accessor even with all structural permissions", () => {
		let calls = 0;
		const schema = z.string().default("x");
		Object.defineProperty(schema._def, "defaultValue", {
			get() {
				calls++;
				throw new Error("forbidden");
			},
		});
		ingestSchemaDocument(schema, { provider: zod4Provider({ execution }) });
		expect(calls).toBe(0);
	});
});
