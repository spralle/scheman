import { describe, expect, it } from "vitest";
import { type JsonSchemaDialect, ingestSchemaDocument, jsonSchemaProvider } from "../index.js";

const cases: { dialect: JsonSchemaDialect; keyword: string; wrap: "single" | "list" | "map" }[] = [
	{ dialect: "draft-2020-12", keyword: "additionalItems", wrap: "single" },
	{ dialect: "draft-2020-12", keyword: "dependencies", wrap: "map" },
	{ dialect: "draft-07", keyword: "prefixItems", wrap: "list" },
	{ dialect: "draft-07", keyword: "dependentSchemas", wrap: "map" },
	{ dialect: "draft-07", keyword: "$defs", wrap: "map" },
	{ dialect: "draft-07", keyword: "unevaluatedProperties", wrap: "single" },
	{ dialect: "draft-07", keyword: "unevaluatedItems", wrap: "single" },
	{ dialect: "draft-07", keyword: "contentSchema", wrap: "single" },
];

describe.each(cases)("#33 R3 $dialect annotation $keyword", ({ dialect, keyword, wrap }) => {
	const anchor = dialect === "draft-07" ? { $id: "#phantom", type: "string" } : { $anchor: "phantom", type: "string" };
	const payload = wrap === "single" ? anchor : wrap === "list" ? [anchor] : { key: anchor };
	it("retains raw data without discovering a phantom anchor", () => {
		const source = { $ref: "#phantom", [keyword]: payload };
		const { document } = ingestSchemaDocument(source, { provider: jsonSchemaProvider({ dialect }) });
		for (const side of ["input", "output"] as const) {
			const root = document.nodes[document.root[side].nodeId];
			expect(root).toMatchObject({
				kind: "ref",
				unresolved: "missing-anchor",
				metadata: { unsupported: { [keyword]: payload } },
			});
			expect(root).not.toHaveProperty("target");
			expect(document.capabilities[side]).toBe("partial");
			expect(document.diagnostics.some((d) => d.side === side && d.code === "JSON_UNSUPPORTED_KEYWORD")).toBe(true);
		}
	});
	it("does not let a pseudo-anchor make a real same-name anchor ambiguous", () => {
		const real = dialect === "draft-07" ? { $id: "#phantom", type: "number" } : { $anchor: "phantom", type: "number" };
		const source = { $ref: "#phantom", definitions: { real }, [keyword]: payload };
		const { document } = ingestSchemaDocument(source, { provider: jsonSchemaProvider({ dialect }) });
		for (const side of ["input", "output"] as const) {
			const root = document.nodes[document.root[side].nodeId];
			if (root.kind !== "ref" || !root.target) throw new Error("real anchor must resolve");
			expect(document.nodes[root.target.nodeId]).toMatchObject({ kind: "primitive", type: "number" });
		}
		expect(document.diagnostics.some((d) => d.code.includes("AMBIGUOUS"))).toBe(false);
	});
});

it("does not scan invalid array-valued 2020-12 items as legacy tuple schemas", () => {
	const { document } = ingestSchemaDocument(
		{ $ref: "#phantom", items: [{ $anchor: "phantom", type: "string" }] },
		{ provider: jsonSchemaProvider() },
	);
	const refs = Object.values(document.nodes).filter((node) => node.kind === "ref");
	expect(refs).toHaveLength(2);
	for (const ref of refs) expect(ref).toMatchObject({ unresolved: "missing-anchor" });
});

it.each([
	{ dialect: "draft-07" as const, keyword: "dependencies", wrap: "map" },
	{ dialect: "draft-07" as const, keyword: "items", wrap: "list" },
	{ dialect: "draft-2020-12" as const, keyword: "dependentSchemas", wrap: "map" },
	{ dialect: "draft-2020-12" as const, keyword: "prefixItems", wrap: "list" },
	{ dialect: "draft-2020-12" as const, keyword: "items", wrap: "single" },
])("still indexes known schema locations: $dialect $keyword", ({ dialect, keyword, wrap }) => {
	const anchor = dialect === "draft-07" ? { $id: "#known", type: "string" } : { $anchor: "known", type: "string" };
	const payload = wrap === "single" ? anchor : wrap === "list" ? [anchor] : { key: anchor };
	const { document } = ingestSchemaDocument(
		{ $ref: "#known", [keyword]: payload },
		{ provider: jsonSchemaProvider({ dialect }) },
	);
	const refs = Object.values(document.nodes).filter((node) => node.kind === "ref");
	expect(refs).toHaveLength(2);
	for (const ref of refs) {
		if (ref.kind !== "ref" || !ref.target) throw new Error("known schema location must resolve");
		expect(document.nodes[ref.target.nodeId]).toMatchObject({ kind: "primitive", type: "string" });
	}
});
