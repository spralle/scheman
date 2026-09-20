import { expect, it, vi } from "vitest";
import type { SchemaNode } from "../document/nodes.js";
import type { NodeRef } from "../document/types.js";
import { SchemaError } from "../errors.js";
import { ingestSchemaDocument } from "../ingest-document.js";
import { standardSchemaProvider } from "../providers/standard-schema.js";

const cases: ((child: NodeRef) => SchemaNode)[] = [
	() => ({ kind: "unknown", reason: "fixture" }),
	() => ({ kind: "opaque", reason: "fixture" }),
	() => ({ kind: "unconstrained", domain: "js" }),
	() => ({ kind: "never" }),
	() => ({ kind: "primitive", type: "bigint" }),
	() => ({ kind: "literal", value: { $type: "undefined" } }),
	() => ({ kind: "enum", values: ["a", null, 1] }),
	(child) => ({
		kind: "object",
		properties: [{ name: "a", presence: "optional", node: child }],
		required: ["absent"],
		additionalProperties: child,
		unknownKeys: "schema",
	}),
	(child) => ({ kind: "array", items: child }),
	(child) => ({ kind: "tuple", items: [child], rest: child }),
	(child) => ({ kind: "record", key: child, value: child, exhaustive: "unknown" }),
	(child) => ({ kind: "union", semantics: "oneOf", alternatives: [child, child], discriminator: "tag" }),
	(child) => ({ kind: "intersection", operands: [child, child] }),
	(child) => ({ kind: "ref", reference: "#", target: child }),
	() => ({ kind: "ref", reference: "https://example.test/", unresolved: "external" }),
	(child) => ({ kind: "wrapper", wrapper: "default", inner: child, value: { $type: "deferred" } }),
];

it.each(cases)("snapshots each node kind with only owned values and live graph refs (%#)", (make) => {
	let source: SchemaNode | undefined;
	const { document } = ingestSchemaDocument(null, {
		provider: {
			name: "node-fixture",
			build(_schema, context) {
				const child = context.node("input", "/child", () => ({ kind: "never" }));
				source = make(child);
				const input = context.node("input", "", () => source as SchemaNode);
				return { input, output: input };
			},
		},
	});
	const snapshot = document.nodes[document.root.input.nodeId];
	expect(snapshot).toEqual(source);
	expect(snapshot).not.toBe(source);
	expect(Object.isFrozen(snapshot)).toBe(true);
	expect(JSON.parse(JSON.stringify(document))).toEqual(document);
	if (snapshot.kind === "unknown" || snapshot.kind === "opaque") {
		expect(document.capabilities).toEqual({ input: "unavailable", output: "unavailable" });
	}
});

it("retains conditional and named applicator edges with prototype-safe maps", () => {
	const { document } = ingestSchemaDocument(null, {
		provider: {
			name: "applicators",
			build(_schema, context) {
				const child = context.node("input", "", () => ({ kind: "never" }));
				const patterns: Record<string, NodeRef> = Object.create(null);
				patterns.__proto__ = child;
				const input = context.node("input", "", () => ({
					kind: "unconstrained",
					domain: "json",
					applicators: {
						if: child,
						not: child,
						contains: child,
						propertyNames: child,
						patternProperties: patterns,
						dependentSchemas: patterns,
					},
					constraints: { dependentRequired: { a: ["b"] } },
				}));
				return { input, output: input };
			},
		},
	});
	expect(document.nodes[document.root.input.nodeId].applicators?.patternProperties?.__proto__).toEqual({
		nodeId: "n1",
	});
});

it("does not materialize accessors on provider nodes", () => {
	const accessor = vi.fn();
	expect(() =>
		ingestSchemaDocument(null, {
			provider: {
				name: "invalid-accessor",
				build(_schema, context) {
					const input = context.node("input", "", () => ({
						kind: "never",
						get metadata() {
							return accessor();
						},
					}));
					return { input, output: input };
				},
			},
		}),
	).toThrow(SchemaError);
	expect(accessor).not.toHaveBeenCalled();
});

it("diagnoses symbol-keyed metadata and array accessors without execution", () => {
	const accessor = vi.fn();
	const array = Object.defineProperty([], "0", { get: accessor, enumerable: true });
	const { document } = ingestSchemaDocument(null, {
		provider: {
			name: "metadata",
			build(_schema, context) {
				context.metadata({ [Symbol.for("hidden")]: true, array });
				const input = context.node("input", "", () => ({ kind: "never" }));
				return { input, output: input };
			},
		},
	});
	expect(accessor).not.toHaveBeenCalled();
	expect(document.diagnostics.map((item) => item.code)).toEqual(["METADATA_SYMBOL_KEYS", "METADATA_ACCESSOR"]);
});

it("rejects accessor limits and budgets unable to hold both roots", () => {
	const accessor = vi.fn();
	expect(() =>
		ingestSchemaDocument(null, {
			provider: standardSchemaProvider(),
			get limits() {
				return accessor();
			},
		}),
	).toThrow(SchemaError);
	expect(accessor).not.toHaveBeenCalled();
	expect(() => ingestSchemaDocument(null, { provider: standardSchemaProvider(), limits: { maxEdges: 1 } })).toThrow(
		SchemaError,
	);
	const limits = Object.defineProperty({}, "maxDepth", { value: -1 });
	expect(() => ingestSchemaDocument(null, { provider: standardSchemaProvider(), limits })).toThrow(SchemaError);
});

it("charges metadata array accessors to the global copying budget", () => {
	const metadata: unknown[] = [];
	const forbidden = vi.fn();
	for (let index = 0; index < 1000; index++) Object.defineProperty(metadata, index, { get: forbidden });
	const { document } = ingestSchemaDocument(null, {
		limits: { maxMetadataEntries: 2 },
		provider: {
			name: "bounded-array-accessors",
			build(_schema, context) {
				context.metadata(metadata);
				const input = context.node("input", "", () => ({ kind: "never" }));
				return { input, output: input };
			},
		},
	});
	expect(document.metadata).toHaveLength(1);
	expect(forbidden).not.toHaveBeenCalled();
	expect(document.diagnostics.map((item) => item.code)).toContain("METADATA_LIMIT");
});

it("does not expose arbitrary thrown vendor objects in provider errors", () => {
	const forbidden = vi.fn();
	const thrown = {
		toString: forbidden,
		get message() {
			return forbidden();
		},
	};
	expect(() =>
		ingestSchemaDocument(null, {
			provider: {
				name: "throws",
				build() {
					throw thrown;
				},
			},
		}),
	).toThrow("Document provider failed to build a valid graph");
	expect(forbidden).not.toHaveBeenCalled();
});

it("rejects a provider that catches a failed node build and leaves a reservation pending", () => {
	expect(() =>
		ingestSchemaDocument(null, {
			provider: {
				name: "failed-reservation",
				build(_source, context) {
					try {
						context.node("input", "", () => {
							throw new Error("fixture");
						});
					} catch {
						/* Deliberately broken provider. */
					}
					const input = context.node("input", "", () => ({ kind: "never" }));
					return { input, output: input };
				},
			},
		}),
	).toThrow(SchemaError);
});
