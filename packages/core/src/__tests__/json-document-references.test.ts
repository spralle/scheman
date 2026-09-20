import { expect, it, vi } from "vitest";
import type { LimitOptions } from "../document/limits.js";
import type { SchemaNode } from "../document/nodes.js";
import type { SchemaDocument } from "../document/types.js";
import { ingestSchemaDocument } from "../ingest-document.js";
import { type JsonSchemaDialect, jsonSchemaProvider } from "../providers/json-schema/index.js";

function ingest(schema: unknown, limits?: LimitOptions, dialect?: JsonSchemaDialect): SchemaDocument {
	return ingestSchemaDocument(schema, {
		provider: jsonSchemaProvider(dialect ? { dialect } : {}),
		...(limits ? { limits } : {}),
	}).document;
}
function root(document: SchemaDocument): SchemaNode {
	return document.nodes[document.root.input.nodeId];
}
function references(document: SchemaDocument): Extract<SchemaNode, { kind: "ref" }>[] {
	return Object.values(document.nodes).filter(
		(node): node is Extract<SchemaNode, { kind: "ref" }> => node.kind === "ref",
	);
}

it.each([
	["draft-07", "branch:leaf"],
	["draft-2020-12", "_branch"],
] as const)("resolves dialect-specific anchor syntax %s / %s", (dialect, name) => {
	const anchor = dialect === "draft-07" ? { $id: `#${name}` } : { $anchor: name };
	const document = ingest(
		{ $ref: `#${name}`, definitions: { target: { ...anchor, type: "string" } } },
		undefined,
		dialect,
	);
	const input = root(document);
	if (input.kind !== "ref" || !input.target) throw new Error("fixture");
	expect(document.nodes[input.target.nodeId]).toMatchObject({ kind: "primitive", type: "string" });
});

it("ignores draft-07 $id siblings of reference objects instead of rebasing them", () => {
	const document = ingest(
		{
			type: "object",
			properties: { child: { $id: "ignored.json", $ref: "#/definitions/value" } },
			definitions: { value: { type: "string" } },
		},
		undefined,
		"draft-07",
	);
	expect(references(document).every((node) => node.target && !node.unresolved)).toBe(true);
	expect(document.diagnostics.some((item) => item.code === "JSON_RESOURCE_REBASE_UNSUPPORTED")).toBe(false);
});

it("does not mistake schema-map property names for resource IDs", () => {
	const document = ingest({ $ref: "#/$defs/value", $defs: { $id: { type: "number" }, value: { type: "string" } } });
	const input = root(document);
	if (input.kind !== "ref" || !input.target) throw new Error("fixture");
	expect(document.nodes[input.target.nodeId]).toMatchObject({ kind: "primitive", type: "string" });
});

it("blocks rebasing throughout reused source subtrees without invoking $id getters", () => {
	const forbidden = vi.fn();
	const shared = { type: "object", properties: { reference: { $ref: "#" } } };
	const schema = {
		type: "object",
		properties: {
			first: shared,
			second: {
				get $id() {
					return forbidden();
				},
				properties: { shared },
			},
		},
	};
	const document = ingest(schema);
	expect(references(document).every((node) => node.unresolved === "resource-rebasing")).toBe(true);
	expect(forbidden).not.toHaveBeenCalled();
});

it("does not confuse anchors in nested resource scopes with document-local anchors", () => {
	const document = ingest({
		$ref: "#local",
		$defs: {
			local: { $anchor: "local", type: "string" },
			remote: { $id: "other.json", $anchor: "local", type: "number" },
		},
	});
	const input = root(document);
	if (input.kind !== "ref" || !input.target) throw new Error("fixture");
	expect(document.nodes[input.target.nodeId]).toMatchObject({ kind: "primitive", type: "string" });
});

it("requires canonical JSON Pointer array indices", () => {
	const allOf = [{ type: "string" }];
	Object.defineProperty(allOf, "00", { value: { type: "number" } });
	const document = ingest({ $ref: "#/allOf/00", allOf }, undefined, "draft-07");
	expect(root(document)).toMatchObject({ kind: "ref", unresolved: "invalid-array-pointer" });
});

it("retains recursive refs as edges and safely serializes deterministic documents", () => {
	const schema = {
		type: "object",
		properties: { self: { $ref: "#" }, children: { type: "array", items: { $ref: "#" } } },
	};
	const document = ingest(schema);
	expect(references(document).filter((node) => node.target?.nodeId === document.root.input.nodeId)).toHaveLength(2);
	expect(references(document).filter((node) => node.target?.nodeId === document.root.output.nodeId)).toHaveLength(2);
	expect(JSON.parse(JSON.stringify(document))).toEqual(document);
	expect(ingest(schema)).toEqual(document);
	expect(document.capabilities).toEqual({ input: "complete", output: "complete" });
});

it("preserves shared source identity independently on each side", () => {
	const shared = { type: "string", title: "shared" };
	const document = ingest({ type: "object", properties: { a: shared, b: shared } });
	const input = root(document);
	if (input.kind !== "object") throw new Error("fixture");
	expect(input.properties[0].node).toEqual(input.properties[1].node);
	const output = document.nodes[document.root.output.nodeId];
	if (output.kind !== "object") throw new Error("fixture");
	expect(output.properties[0].node).not.toEqual(input.properties[0].node);
});

it("handles direct cyclic source identities without copying the schema into metadata", () => {
	const schema: Record<string, unknown> = { type: "object" };
	schema.properties = { self: schema };
	const document = ingest(schema);
	const input = root(document);
	if (input.kind !== "object") throw new Error("fixture");
	expect(input.properties[0].node).toEqual(document.root.input);
	expect(() => JSON.stringify(document)).not.toThrow();
	expect(Object.isFrozen(schema)).toBe(false);
});

it("resolves URI-decoded and escaped JSON Pointer names including prototype-sensitive names", () => {
	const defs = JSON.parse(
		'{"a/b~c":{"type":"string"},"with space":{"type":"number"},"__proto__":{"type":"boolean"},"constructor":false}',
	);
	const document = ingest({
		$defs: defs,
		allOf: [
			{ $ref: "#/$defs/a~1b~0c" },
			{ $ref: "#/$defs/with%20space" },
			{ $ref: "#/$defs/__proto__" },
			{ $ref: "#/$defs/constructor" },
		],
	});
	expect(references(document).every((node) => node.target && !node.unresolved)).toBe(true);
	expect(document.definitions.filter((entry) => entry.side === "input").map((entry) => entry.sourcePointer)).toEqual([
		"/$defs/a~1b~0c",
		"/$defs/with space",
		"/$defs/__proto__",
		"/$defs/constructor",
	]);
});

it("indexes unreachable definitions and preserves separate definition locations with equal names", () => {
	const document = ingest({
		type: "string",
		$defs: { same: { type: "number" }, nested: { $defs: { same: false } } },
		definitions: { same: true },
	});
	const definitions = document.definitions.filter((entry) => entry.side === "input");
	expect(definitions.filter((entry) => entry.name === "same").map((entry) => entry.sourcePointer)).toEqual([
		"/$defs/same",
		"/$defs/nested/$defs/same",
		"/definitions/same",
	]);
	expect(definitions.every((entry) => document.nodes[entry.node.nodeId])).toBe(true);
	expect(root(document)).toMatchObject({ kind: "primitive", type: "string" });
});

it.each(["draft-07", "draft-2020-12"] as const)("resolves local anchors and anchor recursion in %s", (dialect) => {
	const anchor = dialect === "draft-07" ? { $id: "#tree" } : { $anchor: "tree" };
	const document = ingest(
		{ $ref: "#tree", $defs: { tree: { ...anchor, type: "array", items: { $ref: "#tree" } } } },
		undefined,
		dialect,
	);
	expect(references(document).every((node) => node.target && !node.unresolved)).toBe(true);
	const input = root(document);
	if (input.kind !== "ref" || !input.target) throw new Error("fixture");
	const target = document.nodes[input.target.nodeId];
	if (target.kind !== "array") throw new Error("fixture");
	expect(document.nodes[target.items.nodeId]).toMatchObject({ kind: "ref", target: input.target });
});

it("leaves ambiguous anchors unresolved instead of selecting the first declaration", () => {
	const document = ingest({
		$ref: "#same",
		$defs: { a: { $anchor: "same", type: "string" }, b: { $anchor: "same", type: "number" } },
	});
	expect(root(document)).toMatchObject({ kind: "ref", unresolved: "ambiguous-anchor" });
	expect(document.capabilities.input).toBe("partial");
});

it.each([
	"#/missing",
	"#missing",
	"#/%ZZ",
	"#/$defs/a~2b",
	"https://example.test/schema",
	"./other.json",
	"file:///schema.json",
])("retains unresolved reference %s without fetching", (reference) => {
	const fetch = vi.fn(() => {
		throw new Error("no network");
	});
	vi.stubGlobal("fetch", fetch);
	try {
		const document = ingest({ $ref: reference });
		expect(root(document)).toMatchObject({ kind: "ref", reference, unresolved: expect.any(String) });
		expect(fetch).not.toHaveBeenCalled();
		expect(document.diagnostics.some((item) => item.code === "JSON_UNRESOLVED_REFERENCE")).toBe(true);
	} finally {
		vi.unstubAllGlobals();
	}
});

it("does not rebase references against the wrong root beneath nested resource IDs", () => {
	const document = ingest({
		type: "object",
		properties: { child: { $id: "child.json", $ref: "#/$defs/name" } },
		$defs: { name: { type: "string" } },
	});
	expect(references(document).every((node) => node.unresolved === "resource-rebasing")).toBe(true);
	expect(document.diagnostics.some((item) => item.code === "JSON_RESOURCE_REBASE_UNSUPPORTED")).toBe(true);
});

it("does not follow pointers into unsupported resource boundaries", () => {
	const document = ingest({
		$ref: "#/$defs/resource/properties/field",
		$defs: { resource: { $id: "other.json", properties: { field: { type: "string" } } } },
	});
	expect(root(document)).toMatchObject({ kind: "ref", unresolved: "resource-rebasing" });
});

it("retains dynamic references as unresolved edges with raw unsupported metadata", () => {
	const document = ingest({ $dynamicRef: "#tree", $dynamicAnchor: "tree", type: "object" });
	expect(references(document).every((node) => node.unresolved === "dynamic-reference-unsupported")).toBe(true);
	expect(root(document).metadata).toMatchObject({ unsupported: { $dynamicRef: "#tree", $dynamicAnchor: "tree" } });
});

it("applies $ref siblings conjunctively in 2020-12 and ignores them in draft-07", () => {
	const schema = {
		$ref: "#/$defs/value",
		type: "string",
		minimum: 3,
		const: "x",
		$defs: { value: { type: "number" } },
	};
	const modern = ingest(schema);
	expect(root(modern)).toMatchObject({ kind: "intersection", constraints: { minimum: 3 } });
	const legacy = ingest(schema, undefined, "draft-07");
	expect(root(legacy).kind).toBe("ref");
	expect(root(legacy).constraints).toBeUndefined();
	expect(root(legacy).metadata).toMatchObject({ ignoredSiblings: { type: "string", minimum: 3, const: "x" } });
	expect(references(legacy).every((node) => node.target && legacy.nodes[node.target.nodeId].kind === "primitive")).toBe(
		true,
	);
});

it("does not resolve through arbitrary property accessors", () => {
	const forbidden = vi.fn(() => ({ type: "string" }));
	const schema = {
		$ref: "#/$defs/value",
		$defs: {
			get value() {
				return forbidden();
			},
		},
	};
	const document = ingest(schema);
	expect(root(document)).toMatchObject({ kind: "ref", unresolved: "incomplete-reference-index" });
	expect(forbidden).not.toHaveBeenCalled();
});

it.each([
	{ maxNodes: 1 },
	{ maxNodes: 6 },
	{ maxDepth: 2 },
	{ maxEdges: 2 },
	{ maxEdges: 20 },
	{ maxDefinitions: 1 },
	{ maxDiagnostics: 1 },
	{ maxMetadataEntries: 4 },
	{ maxMetadataBytes: 16 },
])("enforces global limits %j without dangling graph refs", (limits) => {
	const schema = {
		type: "object",
		properties: {
			a: { $ref: "#" },
			b: { type: "array", items: { type: "object", properties: { child: { type: "string" } } } },
		},
		$defs: { a: true, b: false },
		unknown: 1,
		"x-data": "x".repeat(100),
	};
	const document = ingest(schema, limits);
	expect(Object.keys(document.nodes).length).toBeLessThanOrEqual(limits.maxNodes ?? 10000);
	expect(document.definitions.length).toBeLessThanOrEqual(limits.maxDefinitions ?? 2000);
	expect(document.diagnostics.length).toBeLessThanOrEqual(limits.maxDiagnostics ?? 200);
	const serialized = JSON.stringify(document);
	for (const match of serialized.matchAll(/"nodeId":"([^"]+)"/g)) expect(document.nodes[match[1]]).toBeDefined();
	expect(document.capabilities.input).not.toBe("complete");
});

it("bounds a large anchor/definition index and does not resolve anchors from an incomplete scan", () => {
	const defs = Object.fromEntries(
		Array.from({ length: 1000 }, (_, index) => [`n${index}`, { $anchor: "duplicate", type: "string" }]),
	);
	const document = ingest({ $ref: "#duplicate", $defs: defs }, { maxEdges: 30, maxDefinitions: 2, maxDiagnostics: 3 });
	expect(document.definitions.length).toBeLessThanOrEqual(2);
	expect(document.diagnostics.length).toBeLessThanOrEqual(3);
	expect(references(document).every((node) => !node.target)).toBe(true);
	expect(JSON.stringify(document).length).toBeLessThan(5000);
});

it("bounds the reference identity index by the global node limit as well as traversal edges", () => {
	const properties = Object.fromEntries(
		Array.from({ length: 1000 }, (_, index) => [`n${index}`, { $anchor: `a${index}`, type: "string" }]),
	);
	const document = ingest({ type: "object", properties }, { maxNodes: 4 });
	expect(Object.keys(document.nodes).length).toBeLessThanOrEqual(4);
	expect(document.diagnostics.some((item) => item.code === "JSON_REFERENCE_INDEX_LIMIT")).toBe(true);
	expect(() => JSON.stringify(document)).not.toThrow();
});
