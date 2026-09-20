import type { StandardSchemaV1 } from "@standard-schema/spec";
import { expect, expectTypeOf, it, vi } from "vitest";
import type { SchemaNode } from "../document/nodes.js";
import type { NodeRef, Side } from "../document/types.js";
import { SchemaError } from "../errors.js";
import { ingestSchemaDocument } from "../ingest-document.js";
import { standardSchemaProvider } from "../providers/standard-schema.js";
import type { DocumentContext, SchemaDocumentProvider } from "../providers/types.js";
import { isStandardSchema } from "../standard.js";

function provider(build: SchemaDocumentProvider["build"]): SchemaDocumentProvider {
	return { name: "fixture", build };
}

function leaf(node: SchemaNode): SchemaDocumentProvider {
	return provider((_source, context) => ({
		input: context.node("input", "", () => node),
		output: context.node("output", "", () => node),
	}));
}

it("reserves IDs before recursion, shares within a side, and separates sides", () => {
	const source = {};
	const build = provider((_schema, context) => {
		const visit = (side: Side): NodeRef =>
			context.visit(source, side, "", () => ({
				kind: "object",
				required: ["self"],
				unknownKeys: "reject",
				properties: [{ name: "self", presence: "required", node: visit(side) }],
			}));
		return { input: visit("input"), output: visit("output") };
	});
	const { document } = ingestSchemaDocument(source, { provider: build });
	expect(document.root.input).not.toEqual(document.root.output);
	const input = document.nodes[document.root.input.nodeId];
	expect(input.kind).toBe("object");
	if (input.kind === "object") expect(input.properties[0].node).toEqual(document.root.input);
	expect(JSON.parse(JSON.stringify(document))).toEqual(document);
	expect(ingestSchemaDocument(source, { provider: build }).document).toEqual(document);
});

it("deeply freezes only owned data, preserving prototype-sensitive names", () => {
	const metadata = JSON.parse('{"__proto__":{"polluted":true},"constructor":[{"x":1}]}');
	const source = { kind: "primitive", type: "string", metadata } as const;
	const { document } = ingestSchemaDocument(source, { provider: leaf(source) });
	const node = document.nodes[document.root.input.nodeId];
	expect(node.metadata).toEqual(metadata);
	expect(Object.getPrototypeOf(node.metadata)).toBeNull();
	expect(Object.isFrozen(document)).toBe(true);
	expect(Object.isFrozen(node.metadata)).toBe(true);
	expect(Object.isFrozen((node.metadata as typeof metadata).constructor[0])).toBe(true);
	expect(Object.isFrozen(metadata)).toBe(false);
	metadata.constructor[0].x = 2;
	expect((node.metadata as typeof metadata).constructor[0].x).toBe(1);
	expect(Object.hasOwn({}, "polluted")).toBe(false);
});

it("does not invoke accessors, toJSON, or coercion while copying metadata", () => {
	const forbidden = vi.fn(() => {
		throw new Error("forbidden");
	});
	const metadata = {
		get secret() {
			return forbidden();
		},
		toJSON: forbidden,
		[Symbol.toPrimitive]: forbidden,
	};
	const { document } = ingestSchemaDocument(null, { provider: leaf({ kind: "never", metadata }) });
	JSON.stringify(document);
	expect(forbidden).not.toHaveBeenCalled();
	expect(document.diagnostics.map((item) => item.code)).toContain("METADATA_ACCESSOR");
	expect(document.capabilities.input).toBe("partial");
});

it("tags cycles and non-JSON values without freezing caller instances", () => {
	const metadata: Record<string, unknown> = {
		date: new Date(),
		bigint: 2n,
		nan: Number.NaN,
		infinity: Number.POSITIVE_INFINITY,
		negativeZero: -0,
	};
	metadata.self = metadata;
	const build = provider((_source, context) => {
		context.metadata(metadata);
		return {
			input: context.node("input", "", () => ({ kind: "never" })),
			output: context.node("output", "", () => ({ kind: "never" })),
		};
	});
	const { document } = ingestSchemaDocument(null, { provider: build });
	expect(() => JSON.stringify(document)).not.toThrow();
	expect(document.metadata).toMatchObject({
		bigint: { $type: "bigint", value: "2" },
		nan: { $type: "number", value: "NaN" },
	});
	expect(document.diagnostics.map((item) => item.code)).toContain("METADATA_CYCLE");
	expect(Object.isFrozen(metadata.date)).toBe(false);
});

it("exposes no mutable builder internals and closes retained contexts", () => {
	let retained: DocumentContext | undefined;
	ingestSchemaDocument(null, {
		provider: provider((_source, context) => {
			retained = context;
			expect(Object.isFrozen(context)).toBe(true);
			expect(Object.hasOwn(context, "finish")).toBe(false);
			const root = context.node("input", "", () => ({ kind: "never" }));
			return { input: root, output: root };
		}),
	});
	expect(() => retained?.node("input", "", () => ({ kind: "never" }))).toThrow(SchemaError);
});
it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, 257, "2"])("rejects invalid depth %s", (maxDepth) => {
	expect(() =>
		ingestSchemaDocument(null, { provider: standardSchemaProvider(), limits: { maxDepth } as never }),
	).toThrow(SchemaError);
});

it("reserves a limit sentinel even when maxNodes is one", () => {
	const { document } = ingestSchemaDocument(null, { provider: standardSchemaProvider(), limits: { maxNodes: 1 } });
	expect(Object.keys(document.nodes)).toHaveLength(1);
	expect(document.root.input).toEqual(document.root.output);
	expect(document.nodes[document.root.input.nodeId]).toMatchObject({ kind: "unknown", reason: "resource-limit" });
});

it("bounds deep acyclic graphs without dangling references", () => {
	const build = provider((_schema, context) => {
		const recurse = (): NodeRef => context.node("input", "", () => ({ kind: "array", items: recurse() }));
		const input = recurse();
		return { input, output: input };
	});
	const { document } = ingestSchemaDocument(null, { provider: build, limits: { maxDepth: 4 } });
	expect(Object.keys(document.nodes)).toHaveLength(5);
	for (const node of Object.values(document.nodes)) {
		if (node.kind === "array") expect(document.nodes[node.items.nodeId]).toBeDefined();
	}
	expect(document.diagnostics.some((item) => item.code === "GRAPH_LIMIT")).toBe(true);
});

it("bounds edges and repeated structural entries", () => {
	const build = provider((_schema, context) => {
		const child = context.node("input", "", () => ({ kind: "never" }));
		const input = context.node("input", "", () => ({
			kind: "union",
			alternatives: Array(100).fill(child),
			semantics: "zod",
		}));
		return { input, output: child };
	});
	const { document } = ingestSchemaDocument(null, { provider: build, limits: { maxEdges: 4 } });
	expect(JSON.stringify(document).length).toBeLessThan(2000);
	expect(document.diagnostics.some((item) => item.code === "GRAPH_LIMIT")).toBe(true);
});

it("caps definitions and diagnostics globally, including a summary slot", () => {
	const build = provider((_schema, context) => {
		const root = context.node("input", "", () => ({ kind: "never" }));
		for (let index = 0; index < 20; index++) context.definition("input", `/${index}`, root);
		return { input: root, output: root };
	});
	const { document } = ingestSchemaDocument(null, {
		provider: build,
		limits: { maxDefinitions: 1, maxDiagnostics: 2 },
	});
	expect(document.definitions).toHaveLength(1);
	expect(document.diagnostics).toHaveLength(2);
	expect(document.diagnostics[1].code).toBe("DIAGNOSTICS_TRUNCATED");
});

it.each([{ maxMetadataEntries: 2 }, { maxMetadataBytes: 4 }])("bounds copied metadata %j", (limits) => {
	const metadata = { long: "x".repeat(1000), nested: [1, 2, 3, 4] };
	const { document } = ingestSchemaDocument(null, { provider: leaf({ kind: "never", metadata }), limits });
	expect(document.diagnostics.some((item) => item.code === "METADATA_LIMIT")).toBe(true);
	expect(JSON.stringify(document)).not.toContain("x".repeat(1000));
});

it("rejects missing providers, forged refs, and malformed node discriminants", () => {
	expect(() => ingestSchemaDocument(null, {} as never)).toThrow(SchemaError);
	expect(() =>
		ingestSchemaDocument(null, { provider: provider(() => ({ input: { nodeId: "n0" }, output: { nodeId: "n0" } })) }),
	).toThrow(SchemaError);
	expect(() => ingestSchemaDocument(null, { provider: leaf({ kind: "invalid" } as never) })).toThrow(SchemaError);
	expect(() => ingestSchemaDocument(null, { provider: leaf({ kind: "array" } as never) })).toThrow(SchemaError);
});
it("retains the original validator, receiver, and generic types without probes", () => {
	const validate = vi.fn(function (
		this: StandardSchemaV1.Props<string, number>,
		value: unknown,
		options?: StandardSchemaV1.Options,
	) {
		expect(this.vendor).toBe("fixture");
		expect(options?.libraryOptions).toEqual({ flag: true });
		return { value: Number(value) };
	});
	const schema: StandardSchemaV1<string, number> = { "~standard": { version: 1, vendor: "fixture", validate } };
	const result = ingestSchemaDocument(schema, { provider: standardSchemaProvider() });
	expectTypeOf(result.validator).toEqualTypeOf<StandardSchemaV1<string, number> | undefined>();
	expect(result.validator).toBe(schema);
	expect(Object.isFrozen(schema)).toBe(false);
	expect(validate).not.toHaveBeenCalled();
	expect(result.document.capabilities).toEqual({ input: "unavailable", output: "unavailable" });
	expect(result.validator?.["~standard"].validate("3", { libraryOptions: { flag: true } })).toEqual({ value: 3 });
});

it("supports async validation and official object path segments only when the consumer calls", async () => {
	const issues: readonly StandardSchemaV1.Issue[] = [
		{ message: "invalid", path: ["items", { key: 0 }, Symbol.for("field")] },
	];
	const validate = vi.fn(async () => ({ issues }));
	const schema = { "~standard": { version: 1 as const, vendor: "fixture", validate } };
	const result = ingestSchemaDocument(schema, { provider: standardSchemaProvider() });
	expect(validate).not.toHaveBeenCalled();
	expect(await result.validator?.["~standard"].validate(null)).toEqual({ issues });
});

it("never reads Standard contract getters or accepts an inherited contract", () => {
	const forbidden = vi.fn(() => {
		throw new Error("forbidden");
	});
	expect(
		isStandardSchema({
			get "~standard"() {
				return forbidden();
			},
		}),
	).toBe(false);
	expect(
		isStandardSchema({
			"~standard": {
				version: 1,
				vendor: "fixture",
				get validate() {
					return forbidden();
				},
			},
		}),
	).toBe(false);
	expect(isStandardSchema(Object.create({ "~standard": { version: 1, vendor: "fixture", validate: forbidden } }))).toBe(
		false,
	);
	expect(forbidden).not.toHaveBeenCalled();
});
