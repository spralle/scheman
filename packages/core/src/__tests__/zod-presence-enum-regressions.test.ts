import { describe, expect, it } from "vitest";
import { z as z3 } from "zod3";
import { z as z3min } from "zod3-min";
import { z as z4 } from "zod4";
import { z as z4min } from "zod4-min";
import { ingestSchemaDocument, zod3Provider, zod4Provider } from "../index.js";

const execution = { shape: "allow", metadata: "allow" } as const;
const matrix = [
	{ name: "3.24.0", z: z3min as typeof z3, provider: zod3Provider, version: 3 },
	{ name: "3.25.76", z: z3, provider: zod3Provider, version: 3 },
	{ name: "4.0.0", z: z4min as unknown as typeof z3, provider: zod4Provider, version: 4 },
	{ name: "4.1.5", z: z4 as unknown as typeof z3, provider: zod4Provider, version: 4 },
];

describe.each(matrix)("#33 R1/R2 Zod $name", ({ z, provider, version }) => {
	it("recognizes undefined literals through nullable and union properties on both sides without probes", () => {
		let calls = 0;
		const literal = z.literal(undefined);
		const source = z.object({
			literal,
			nullable: literal.nullable(),
			union: z.union([z.string(), literal]),
			nested: z.union([literal.nullable(), z.number()]),
			required: z.literal("value"),
		});
		for (const schema of [source, literal]) {
			const forbidden = () => {
				calls++;
				throw new Error("probe");
			};
			for (const key of ["parse", "safeParse", "isOptional", "isNullable"])
				Object.defineProperty(schema, key, { value: forbidden });
			Object.defineProperty(schema, "~standard", { value: { version: 1, vendor: "zod", validate: forbidden } });
		}
		const { document } = ingestSchemaDocument(source, { provider: provider({ execution }) });
		for (const side of ["input", "output"] as const) {
			const root = document.nodes[document.root[side].nodeId];
			expect(root).toMatchObject({ kind: "object", required: ["required"] });
			if (root.kind !== "object") throw new Error("object required");
			expect(root.properties.map((property) => property.presence)).toEqual([
				"optional",
				"optional",
				"optional",
				"optional",
				"required",
			]);
			const leaf = document.nodes[root.properties[0].node.nodeId];
			expect(leaf).toMatchObject({ kind: "literal", value: { $type: "undefined" } });
		}
		expect(calls).toBe(0);
	});

	it.each([
		{ name: "ambiguous string member", entries: { One: "A", A: 1 }, v3: [1], v4: ["A", 1] },
		{ name: "numeric reverse mappings", entries: { 0: "A", 1: "B", A: 0, B: 1 }, v3: [0, 1], v4: [0, 1] },
		{ name: "heterogeneous", entries: { 0: "A", A: 0, B: "label", C: 2 }, v3: [0, "label", 2], v4: [0, "label", 2] },
		{
			name: "ordered ambiguous members",
			entries: { First: "Second", Second: 2, Last: "tail" },
			v3: [2, "tail"],
			v4: ["Second", 2, "tail"],
		},
		{
			name: "numeric key without reverse value",
			entries: { 3: "three", Label: "label" },
			v3: ["three", "label"],
			v4: ["three", "label"],
		},
	])("preserves version-specific nativeEnum values: $name", ({ entries, v3, v4 }) => {
		const { document } = ingestSchemaDocument(z.nativeEnum(entries), { provider: provider({ execution }) });
		for (const side of ["input", "output"] as const) {
			expect(document.nodes[document.root[side].nodeId]).toMatchObject({
				kind: "enum",
				values: version === 3 ? v3 : v4,
			});
		}
	});
});

describe.each([
	{ name: "4.0.0", z: z4min },
	{ name: "4.1.5", z: z4 },
])("#33 v4-specific evidence $name", ({ z }) => {
	it("preserves ambiguous enum object entries as well as nativeEnum", () => {
		const { document } = ingestSchemaDocument(z.enum({ One: "A", A: 1 }), { provider: zod4Provider({ execution }) });
		for (const side of ["input", "output"] as const)
			expect(document.nodes[document.root[side].nodeId]).toMatchObject({ kind: "enum", values: ["A", 1] });
	});
	it("makes multi-literals containing undefined optional on both sides", () => {
		const source = z.object({
			x: z.literal(["x", undefined]),
			nullable: z.literal([undefined, 1]).nullable(),
			required: z.literal(["x", 1]),
		});
		const { document } = ingestSchemaDocument(source, { provider: zod4Provider({ execution }) });
		for (const side of ["input", "output"] as const) {
			const root = document.nodes[document.root[side].nodeId];
			if (root.kind !== "object") throw new Error("object required");
			expect(root.properties.map((property) => property.presence)).toEqual(["optional", "optional", "required"]);
			expect(document.nodes[root.properties[0].node.nodeId]).toMatchObject({
				kind: "enum",
				values: ["x", { $type: "undefined" }],
			});
		}
	});
	it("keeps deferred default output presence unknown through optional wrappers", () => {
		let calls = 0;
		const defaulted = z.string().default(() => {
			calls++;
			return "x";
		});
		const source = z.object({
			x: defaulted.optional(),
			nested: defaulted.optional().nullable().optional(),
			constant: z.string().default("x").optional(),
			plain: z.string().optional(),
		});
		const { document } = ingestSchemaDocument(source, { provider: zod4Provider({ execution }) });
		for (const side of ["input", "output"] as const) {
			const root = document.nodes[document.root[side].nodeId];
			if (root.kind !== "object") throw new Error("object required");
			expect(root.properties.map((property) => property.presence)).toEqual(
				side === "input"
					? ["optional", "optional", "optional", "optional"]
					: ["unknown", "unknown", "unknown", "optional"],
			);
		}
		expect(calls).toBe(0);
	});
});
