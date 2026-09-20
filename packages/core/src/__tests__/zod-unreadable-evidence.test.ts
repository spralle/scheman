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

describe.each(matrix)("#33 R4 Zod $name", ({ z, provider, version }) => {
	it.each(["accessor", "absent"])("never invents undefined from %s literal evidence", (mode) => {
		let calls = 0;
		const literal = z.literal("x");
		const target = version === 3 ? literal._def : (literal._def as unknown as { values: unknown[] }).values;
		const key = version === 3 ? "value" : "0";
		if (mode === "accessor")
			Object.defineProperty(target, key, {
				get() {
					calls++;
					throw new Error("forbidden");
				},
			});
		else Reflect.deleteProperty(target, key);
		const source = z.object({ x: literal, nullable: literal.nullable(), union: z.union([z.string(), literal]) });
		const { document } = ingestSchemaDocument(source, { provider: provider({ execution }) });
		for (const side of ["input", "output"] as const) {
			const root = document.nodes[document.root[side].nodeId];
			if (root.kind !== "object") throw new Error("object required");
			expect(root.properties.map((property) => property.presence)).toEqual(["unknown", "unknown", "unknown"]);
			expect(document.nodes[root.properties[0].node.nodeId]).toMatchObject({
				kind: "unknown",
				reason: "zod.values-unreadable",
			});
			expect(document.capabilities[side]).toBe("partial");
			expect(document.diagnostics.some((d) => d.side === side && d.code === "zod.values-unreadable")).toBe(true);
		}
		expect(JSON.stringify(document)).not.toContain('"$type":"undefined"');
		expect(calls).toBe(0);
	});

	it.each([
		"checks",
		"check-index",
		"check-value",
		"check-value-hidden",
		"minLength",
		"description",
		"metadata",
		"source-metadata",
		"coerce",
	])("diagnoses inaccessible %s while retaining base structure", (location) => {
		let calls = 0;
		const source = z.string().min(5);
		let target: object = source._def;
		let key = location;
		if (location === "check-index") {
			target = source._def.checks;
			key = "0";
		}
		if (location === "check-value" || location === "check-value-hidden") {
			const check = source._def.checks[0];
			target = version === 3 ? check : (check as unknown as { _zod: { def: object } })._zod.def;
			key = version === 3 ? "value" : "minimum";
		}
		if (location === "source-metadata") {
			target = source;
			key = "metadata";
		}
		Object.defineProperty(target, key, {
			get() {
				calls++;
				throw new Error("forbidden");
			},
			configurable: true,
			enumerable: location !== "check-value-hidden",
		});
		const { document } = ingestSchemaDocument(source, { provider: provider({ execution }) });
		for (const side of ["input", "output"] as const) {
			expect(document.nodes[document.root[side].nodeId]).toMatchObject({ kind: "primitive", type: "string" });
			expect(document.capabilities[side]).toBe("partial");
			expect(document.diagnostics.some((d) => d.side === side)).toBe(true);
		}
		expect(calls).toBe(0);
	});

	it.each(["absent", "undefined", "empty"])("does not diagnose valid %s optional check evidence", (mode) => {
		const source = z.string();
		if (mode === "absent") Reflect.deleteProperty(source._def, "checks");
		else Object.defineProperty(source._def, "checks", { value: mode === "undefined" ? undefined : [] });
		const { document } = ingestSchemaDocument(source, { provider: provider({ execution }) });
		expect(document.capabilities).toEqual({ input: "complete", output: "complete" });
		expect(document.diagnostics).toEqual([]);
	});

	it("does not infer a catchall policy or absent tuple rest from accessors", () => {
		let calls = 0;
		const get = () => {
			calls++;
			throw new Error("forbidden");
		};
		const object = z.object({}).catchall(z.string());
		Object.defineProperty(object._def, "catchall", { get });
		const tuple = z.tuple([z.string()]).rest(z.number());
		Object.defineProperty(tuple._def, "rest", { get });
		for (const source of [object, tuple]) {
			const { document } = ingestSchemaDocument(source, { provider: provider({ execution }) });
			for (const side of ["input", "output"] as const) {
				const root = document.nodes[document.root[side].nodeId];
				if (root.kind === "object") expect(root.unknownKeys).toBe("unknown");
				else if (root.kind === "tuple" && root.rest) expect(document.nodes[root.rest.nodeId].kind).toBe("unknown");
				else throw new Error("missing structure");
				expect(document.capabilities[side]).toBe("partial");
			}
		}
		expect(calls).toBe(0);
	});

	it("does not fabricate enum membership from an unreadable entry", () => {
		let calls = 0;
		const source = z.nativeEnum({ One: "A", A: 1 });
		const raw = (source._def as unknown as Record<string, object>)[version === 3 ? "values" : "entries"];
		Object.defineProperty(raw, "A", {
			get() {
				calls++;
				throw new Error("forbidden");
			},
		});
		const { document } = ingestSchemaDocument(source, { provider: provider({ execution }) });
		for (const side of ["input", "output"] as const)
			expect(document.nodes[document.root[side].nodeId].kind).toBe("unknown");
		expect(document.diagnostics.length).toBeGreaterThan(0);
		expect(calls).toBe(0);
	});
});

describe.each([
	{ name: "4.0.0", z: z4min },
	{ name: "4.1.5", z: z4 },
])("#33 R4 v4 $name", ({ z }) => {
	it("does not execute or silently discard an inaccessible metadata method", () => {
		let calls = 0;
		const source = z.string();
		Object.defineProperty(source, "meta", {
			get() {
				calls++;
				throw new Error("forbidden");
			},
		});
		const { document } = ingestSchemaDocument(source, { provider: zod4Provider({ execution }) });
		expect(document.capabilities).toEqual({ input: "partial", output: "partial" });
		expect(document.diagnostics.filter((d) => d.code === "zod.metadata-unreadable")).toHaveLength(2);
		expect(calls).toBe(0);
	});
	it("does not turn one unreadable multi-literal alternative into a known undefined", () => {
		let calls = 0;
		const source = z.literal(["x", "y"]);
		Object.defineProperty(source._def.values, "0", {
			get() {
				calls++;
				throw new Error("forbidden");
			},
		});
		const { document } = ingestSchemaDocument(source, { provider: zod4Provider({ execution }) });
		for (const side of ["input", "output"] as const)
			expect(document.nodes[document.root[side].nodeId].kind).toBe("unknown");
		expect(calls).toBe(0);
	});
});
