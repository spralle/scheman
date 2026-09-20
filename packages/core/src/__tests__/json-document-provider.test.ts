import { expect, it, vi } from "vitest";
import type { SchemaNode } from "../document/nodes.js";
import type { SchemaDocument, Side } from "../document/types.js";
import { ingestSchemaDocument } from "../ingest-document.js";
import { type JsonSchemaDialect, jsonSchemaProvider } from "../providers/json-schema/index.js";

function ingest(schema: unknown, dialect?: JsonSchemaDialect): SchemaDocument {
	return ingestSchemaDocument(schema, { provider: jsonSchemaProvider(dialect ? { dialect } : {}) }).document;
}
function root(document: SchemaDocument, side: Side = "input"): SchemaNode {
	return document.nodes[document.root[side].nodeId];
}
function nodes(document: SchemaDocument, kind: SchemaNode["kind"]): SchemaNode[] {
	return Object.values(document.nodes).filter((node) => node.kind === kind);
}

it("retains numeric, string, array and object bounds without validation or keyword rewriting", () => {
	const bounds = {
		minimum: 0,
		maximum: 10,
		exclusiveMinimum: 1,
		exclusiveMaximum: 9,
		multipleOf: 2,
		minLength: 1,
		maxLength: 5,
		pattern: "^a",
		format: "email",
		minItems: 1,
		maxItems: 4,
		uniqueItems: true,
		minProperties: 1,
		maxProperties: 4,
		contentEncoding: "base64",
		contentMediaType: "text/plain",
	};
	const document = ingest(bounds);
	expect(root(document)).toMatchObject({ kind: "unconstrained", domain: "json", constraints: bounds });
	expect(document.capabilities).toEqual({ input: "complete", output: "complete" });
});

it("diagnoses invalid definition maps and symbolic source keys", () => {
	const document = ingest({ type: "string", $defs: [], [Symbol.for("hidden")]: true });
	expect(document.capabilities.input).toBe("partial");
	expect(document.diagnostics.map((item) => item.code)).toContain("JSON_INVALID_KEYWORD");
	expect(document.diagnostics.map((item) => item.code)).toContain("JSON_SYMBOL_KEY_UNSUPPORTED");
	expect(() => jsonSchemaProvider(null as never)).toThrow();
});

it.each([true, false])("preserves boolean schema %s", (schema) => {
	const document = ingest(schema);
	expect(root(document).kind).toBe(schema ? "unconstrained" : "never");
	expect(root(document, "output")).toEqual(root(document));
	expect(document.capabilities).toEqual({ input: "complete", output: "complete" });
});

it.each(["type", "properties", "items", "$ref", "$defs", "$schema", "default", "const", "enum"])(
	"does not execute the %s keyword accessor",
	(keyword) => {
		const forbidden = vi.fn(() => {
			throw new Error("forbidden getter");
		});
		const schema = Object.defineProperty({ type: "object" }, keyword, { get: forbidden, enumerable: true });
		const document = ingest(schema);
		expect(forbidden).not.toHaveBeenCalled();
		expect(document.diagnostics.some((item) => item.code === "JSON_ACCESSOR_UNAVAILABLE")).toBe(true);
		expect(() => JSON.stringify(document)).not.toThrow();
	},
);

it.each(["string", "number", "integer", "boolean", "null"])("preserves scalar %s on both sides", (type) => {
	const document = ingest({ type, format: "date-time" });
	expect(root(document)).toMatchObject({ kind: "primitive", type, constraints: { format: "date-time" } });
	expect(root(document, "output")).toEqual(root(document));
	expect(document.root.input).not.toEqual(document.root.output);
});

it("retains multiple types and does not turn date-formatted strings into dates", () => {
	const document = ingest({ type: ["null", "string"], format: "date" });
	const input = root(document);
	expect(input.kind).toBe("union");
	if (input.kind !== "union") throw new Error("fixture");
	expect(input.alternatives.map((ref) => document.nodes[ref.nodeId])).toEqual([
		{ kind: "primitive", type: "null" },
		{ kind: "primitive", type: "string" },
	]);
});

it("keeps object-local requiredness independent of optional parents and annotations", () => {
	const document = ingest({
		type: "object",
		properties: {
			parent: {
				type: "object",
				required: ["child", "absent"],
				properties: { child: { type: "string", default: "x" } },
			},
		},
	});
	const input = root(document);
	if (input.kind !== "object") throw new Error("fixture");
	expect(input.properties[0].presence).toBe("optional");
	const parent = document.nodes[input.properties[0].node.nodeId];
	if (parent.kind !== "object") throw new Error("fixture");
	expect(parent.required).toEqual(["child", "absent"]);
	expect(parent.properties[0].presence).toBe("required");
	expect(parent.unknownKeys).toBe("passthrough");
});

it("does not infer object-only acceptance from properties or required", () => {
	const document = ingest({ properties: { x: { type: "string" } }, required: ["x"] });
	const input = root(document);
	if (input.kind !== "union") throw new Error("fixture");
	const alternatives = input.alternatives.map((ref) => document.nodes[ref.nodeId]);
	expect(alternatives.map((node) => node.kind)).toEqual([
		"primitive",
		"primitive",
		"primitive",
		"primitive",
		"array",
		"object",
	]);
	expect(alternatives[5]).toMatchObject({ properties: [{ name: "x", presence: "required" }], required: ["x"] });
});

it.each([false, true, { type: "number" }])(
	"retains additionalProperties %j and record-like values",
	(additionalProperties) => {
		const document = ingest({ type: "object", additionalProperties });
		const input = root(document);
		if (input.kind !== "object" || !input.additionalProperties) throw new Error("fixture");
		expect(input.unknownKeys).toBe(
			additionalProperties === false ? "reject" : additionalProperties === true ? "passthrough" : "schema",
		);
		expect(document.nodes[input.additionalProperties.nodeId].kind).toBe(
			additionalProperties === false ? "never" : additionalProperties === true ? "unconstrained" : "primitive",
		);
	},
);

it.each(["draft-07", "draft-2020-12"] as const)("retains homogeneous arrays in %s", (dialect) => {
	const document = ingest(
		{ type: "array", items: { type: "object", properties: { x: { type: "number" } } }, minItems: 1 },
		dialect,
	);
	const input = root(document);
	if (input.kind !== "array") throw new Error("fixture");
	expect(document.nodes[input.items.nodeId]).toMatchObject({ kind: "object", properties: [{ name: "x" }] });
	expect(input.constraints).toEqual({ minItems: 1 });
});

it.each(["draft-07", "draft-2020-12"] as const)("retains ordered tuple items and rest in %s", (dialect) => {
	const schema =
		dialect === "draft-07"
			? { type: "array", items: [{ type: "string" }, { type: "number" }], additionalItems: false }
			: { type: "array", prefixItems: [{ type: "string" }, { type: "number" }], items: false };
	const document = ingest(schema, dialect);
	const input = root(document);
	if (input.kind !== "tuple" || !input.rest) throw new Error("fixture");
	expect(input.items.map((ref) => document.nodes[ref.nodeId])).toMatchObject([{ type: "string" }, { type: "number" }]);
	expect(document.nodes[input.rest.nodeId].kind).toBe("never");
});

it("uses dialect-specific tuple keywords instead of interpreting draft-07 items arrays as modern tuples", () => {
	const document = ingest({ type: "array", items: [{ type: "string" }], additionalItems: false });
	expect(root(document).kind).toBe("array");
	expect(document.capabilities.input).toBe("partial");
	expect(nodes(document, "tuple")).toHaveLength(0);
	expect(root(document).metadata).toMatchObject({ unsupported: { additionalItems: false } });
});

it("keeps anyOf, oneOf, allOf and sibling constraints conjunctive rather than flattening or merging", () => {
	const document = ingest({
		type: "number",
		minimum: 3,
		allOf: [{ maximum: 1 }, { minimum: 8 }],
		anyOf: [{ const: 2 }, { const: 3 }],
		oneOf: [{ type: "integer" }, { type: "number" }],
	});
	const input = root(document);
	if (input.kind !== "intersection") throw new Error("fixture");
	expect(input.operands.map((ref) => document.nodes[ref.nodeId].kind)).toEqual([
		"primitive",
		"intersection",
		"union",
		"union",
	]);
	expect(input.constraints).toEqual({ minimum: 3 });
	expect(nodes(document, "union").map((node) => node.kind === "union" && node.semantics)).toContain("oneOf");
	expect(nodes(document, "union").map((node) => node.kind === "union" && node.semantics)).toContain("anyOf");
	expect(
		nodes(document, "intersection").some((node) => node.kind === "intersection" && node.operands.length === 2),
	).toBe(true);
});

it("keeps const distinct from default and retains enum values without coercion", () => {
	const document = ingest({ const: "a", default: "b", enum: ["a", 1, false, null] });
	expect(root(document).metadata).toMatchObject({ annotations: { default: "b" } });
	expect(nodes(document, "literal")).toContainEqual({ kind: "literal", value: "a" });
	expect(nodes(document, "enum")).toContainEqual({ kind: "enum", values: ["a", 1, false, null] });
});

it("retains every common applicator edge and dependent required constraints", () => {
	const schema = JSON.parse(
		'{"if":{"required":["a"]},"then":{"required":["b"]},"else":false,"not":{"type":"null"},"contains":{"type":"string"},"propertyNames":{"pattern":"^x"},"patternProperties":{"__proto__":{"type":"number"}},"dependentSchemas":{"a":{"required":["b"]}},"dependentRequired":{"a":["b"]},"minContains":1,"maxContains":2}',
	);
	const document = ingest(schema);
	const input = root(document);
	expect(Object.keys(input.applicators ?? {})).toEqual([
		"if",
		"then",
		"else",
		"not",
		"contains",
		"propertyNames",
		"patternProperties",
		"dependentSchemas",
	]);
	expect(input.constraints).toEqual({ dependentRequired: { a: ["b"] }, minContains: 1, maxContains: 2 });
	expect(input.applicators?.patternProperties?.__proto__).toHaveProperty("nodeId");
	expect(document.nodes[input.applicators?.else?.nodeId ?? ""].kind).toBe("never");
});

it("normalizes draft-07 schema and property dependencies without interpreting modern siblings", () => {
	const document = ingest(
		{ dependencies: { a: ["b"], c: { required: ["d"] } }, dependentRequired: { x: ["y"] } },
		"draft-07",
	);
	expect(root(document).constraints).toEqual({ dependentRequired: { a: ["b"] } });
	expect(Object.keys(root(document).applicators?.dependentSchemas ?? {})).toEqual(["c"]);
	expect(root(document).metadata).toMatchObject({ unsupported: { dependentRequired: { x: ["y"] } } });
});

it("retains exact annotations/extensions/unsupported raw keys as owned metadata without UI aliases", () => {
	const schema = JSON.parse(
		'{"type":"string","title":"Name","x-label":["a",{"n":1}],"x-count":2,"x-flag":false,"constructor":{"v":1},"__proto__":{"polluted":true},"unevaluatedProperties":false}',
	);
	const document = ingest(schema);
	expect(root(document).metadata).toMatchObject({
		annotations: { title: "Name" },
		extensions: { "x-label": ["a", { n: 1 }], "x-count": 2, "x-flag": false },
		unsupported: { constructor: { v: 1 }, unevaluatedProperties: false },
	});
	expect(JSON.stringify(document)).toContain('"__proto__":{"polluted":true}');
	schema["x-label"][1].n = 2;
	expect(JSON.stringify(document)).toContain('"n":1');
	expect(Object.isFrozen(schema)).toBe(false);
	expect(Object.isFrozen(root(document).metadata)).toBe(true);
	expect(document.diagnostics.some((item) => item.code === "JSON_UNSUPPORTED_KEYWORD")).toBe(true);
});

it("never executes schema/property/default accessors, factories, toJSON or validation", () => {
	const forbidden = vi.fn(() => {
		throw new Error("must not execute");
	});
	const properties = {
		get field() {
			return forbidden();
		},
	};
	const schema = {
		type: "object",
		properties,
		default: forbidden,
		toJSON: forbidden,
		get title() {
			return forbidden();
		},
		"~standard": { version: 1, vendor: "fixture", validate: forbidden },
	};
	const result = ingestSchemaDocument(schema, { provider: jsonSchemaProvider() });
	JSON.stringify(result.document);
	expect(forbidden).not.toHaveBeenCalled();
	expect(result.validator).toBe(schema);
	expect(result.document.capabilities.input).toBe("partial");
	expect(result.document.diagnostics.some((item) => item.code === "JSON_ACCESSOR_UNAVAILABLE")).toBe(true);
});

it("records selected, conflicting and unsupported dialects", () => {
	expect(ingest({}).metadata).toMatchObject({ dialect: "draft-2020-12", dialectSource: "default" });
	expect(ingest({ $schema: "http://json-schema.org/draft-07/schema#" }).metadata).toMatchObject({
		dialect: "draft-07",
		dialectSource: "$schema",
	});
	const conflict = ingest({ $schema: "http://json-schema.org/draft-07/schema#" }, "draft-2020-12");
	expect(conflict.diagnostics.some((item) => item.code === "JSON_DIALECT_CONFLICT")).toBe(true);
	expect(
		ingest({ $schema: "https://example.test/custom" }).diagnostics.some(
			(item) => item.code === "JSON_UNSUPPORTED_DIALECT",
		),
	).toBe(true);
	expect(() => jsonSchemaProvider({ dialect: "draft-04" } as never)).toThrow();
});

it.each([null, undefined, 1, "string", [], new Date()])(
	"marks invalid JSON source %j unknown instead of fabricating structure",
	(schema) => {
		const document = ingest(schema);
		expect(root(document).kind).toBe("unknown");
		expect(document.capabilities).toEqual({ input: "unavailable", output: "unavailable" });
	},
);
