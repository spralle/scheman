import { describe, expect, it } from "vitest";
import { z as z3 } from "zod3";
import { z as z4 } from "zod4";
import { ingestSchemaDocument } from "../ingest-document.js";
import { zod3Provider } from "../providers/zod3/index.js";
import { zod4Provider } from "../providers/zod4/index.js";

const execution = { shape: "allow", lazy: "allow", metadata: "allow" } as const;

describe("Zod graph descriptor safety and budgets", () => {
	it("retains Date and RegExp check slots without user getters or coercion hooks", () => {
		let calls = 0;
		const forbidden = () => {
			calls++;
			throw new Error("forbidden");
		};
		const date = new Date(0);
		date.getTime = forbidden;
		date.toJSON = forbidden;
		const regex = /a+/gi;
		for (const key of ["source", "flags", "global", "ignoreCase"])
			Object.defineProperty(regex, key, { get: forbidden });
		const schema = z4.string().regex(regex);
		const document = ingestSchemaDocument(schema, { provider: zod4Provider({ execution }) }).document;
		expect(JSON.stringify(document)).toContain('"source":"a+","flags":"gi"');
		const bounded = ingestSchemaDocument(z4.date().min(date), { provider: zod4Provider({ execution }) }).document;
		expect(JSON.stringify(bounded)).toContain('"milliseconds":0');
		expect(calls).toBe(0);
	});
	it("does not invent unconstrained schemas or undefined literals from unreadable definitions", () => {
		let calls = 0;
		const literal = { typeName: "ZodLiteral" };
		Object.defineProperty(literal, "value", {
			get() {
				calls++;
				return undefined;
			},
		});
		const unreadable = ingestSchemaDocument({ _def: literal }, { provider: zod3Provider() }).document;
		expect(unreadable.nodes[unreadable.root.input.nodeId].kind).toBe("unknown");
		const missing = ingestSchemaDocument({ _zod: { def: {} } }, { provider: zod4Provider() }).document;
		expect(missing.nodes[missing.root.input.nodeId].kind).toBe("opaque");
		expect(calls).toBe(0);
	});
	it("does not access schema, definition, check or metadata getters", () => {
		let calls = 0;
		const get = () => {
			calls++;
			throw new Error("forbidden");
		};
		const schema = Object.defineProperty({}, "_def", { get });
		const definition = Object.defineProperty({}, "typeName", { get });
		const check = Object.defineProperty({ kind: "min" }, "value", { get, enumerable: true });
		const string = z3.string();
		string._def.checks.push(check as never);
		Object.defineProperty(string._def, "description", { get });
		Object.defineProperty(string._def, "metadata", {
			value: Object.defineProperty({}, "x-ui", { get, enumerable: true }),
		});
		for (const source of [schema, { _def: definition }, string]) {
			expect(() => ingestSchemaDocument(source, { provider: zod3Provider({ execution }) })).not.toThrow();
		}
		expect(calls).toBe(0);
	});
	it("retains original Standard validator without probing it or alternate parse methods", () => {
		let calls = 0;
		const source = z4.string();
		const validate = () => {
			calls++;
			throw new Error("forbidden");
		};
		Object.defineProperty(source, "~standard", { value: { version: 1, vendor: "zod", validate } });
		Object.defineProperty(source, "safeParse", {
			get() {
				calls++;
				throw new Error("forbidden");
			},
		});
		const result = ingestSchemaDocument(source, { provider: zod4Provider({ execution }) });
		expect(result.validator).toBe(source);
		expect(calls).toBe(0);
		expect(Object.isFrozen(source)).toBe(false);
	});
	it("validates passive narrow policies and never evaluates option accessors", () => {
		let calls = 0;
		const options = Object.defineProperty({}, "execution", {
			get() {
				calls++;
				return {};
			},
		});
		expect(() => zod3Provider(options)).toThrow();
		expect(() => zod4Provider({ execution: { lazy: true } } as never)).toThrow();
		expect(calls).toBe(0);
	});
	it("keeps structural permissions independent and resets caches for each ingestion", () => {
		let calls = 0;
		const source = z3.lazy(() => {
			calls++;
			return z3.object({ x: z3.string() });
		});
		const provider = zod3Provider({ execution: { lazy: "allow" } });
		const first = ingestSchemaDocument(source, { provider }).document;
		expect(calls).toBe(1);
		expect(first.diagnostics.some((d) => d.code === "zod.execution.shape.denied")).toBe(true);
		ingestSchemaDocument(source, { provider });
		expect(calls).toBe(2);
	});
	it("caches failed metadata reads and preserves successful structural sides", () => {
		let calls = 0;
		const schema = z4.string();
		schema.meta = (() => {
			calls++;
			throw new Error("secret");
		}) as typeof schema.meta;
		const document = ingestSchemaDocument(schema, { provider: zod4Provider({ execution }) }).document;
		expect(calls).toBe(1);
		expect(document.nodes[document.root.output.nodeId]).toMatchObject({ kind: "primitive", type: "string" });
		expect(document.diagnostics.filter((d) => d.code === "zod.execution.metadata.failed")).toHaveLength(2);
		expect(JSON.stringify(document)).not.toContain("secret");
	});
	it("owns prototype-sensitive, cyclic and non-JSON metadata without hooks", () => {
		let calls = 0;
		const meta = Object.create(null);
		Object.assign(meta, {
			__proto__: null,
			constructor: [1],
			scalar: false,
			bigint: 4n,
			toJSON: () => {
				calls++;
			},
		});
		Object.defineProperty(meta, "__proto__", { value: "literal", enumerable: true });
		meta.cycle = meta;
		const schema = z3.string();
		Object.defineProperty(schema._def, "metadata", { value: meta });
		const document = ingestSchemaDocument(schema, { provider: zod3Provider() }).document;
		const serialized = JSON.stringify(document);
		expect(serialized).toContain('"__proto__":"literal"');
		expect(serialized).toContain('"constructor":[1]');
		expect(serialized).toContain('"scalar":false');
		expect(calls).toBe(0);
		expect(Object.isFrozen(meta)).toBe(false);
	});
	it("bounds broad shared graphs before parent snapshots account for their edges", () => {
		const shared = z3.string();
		const shape = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`p${i}`, shared]));
		const document = ingestSchemaDocument(z3.object(shape), {
			provider: zod3Provider({ execution }),
			limits: { maxEdges: 8 },
		}).document;
		expect(document.diagnostics.some((d) => d.code === "zod.traversal-limit")).toBe(true);
		expect(JSON.stringify(document).length).toBeLessThan(5000);
	});
	it("does not resolve further source thunks after depth truncation", () => {
		let calls = 0;
		const schema = z3.object({
			nested: z3.lazy(() => {
				calls++;
				return z3.string();
			}),
		});
		const document = ingestSchemaDocument(schema, {
			provider: zod3Provider({ execution }),
			limits: { maxDepth: 1 },
		}).document;
		expect(calls).toBe(0);
		expect(document.capabilities.input).not.toBe("complete");
	});
	it("retains opaque custom checks without invoking them", () => {
		let calls = 0;
		const schema = z4.string().refine(() => {
			calls++;
			return false;
		});
		const document = ingestSchemaDocument(schema, { provider: zod4Provider({ execution }) }).document;
		expect(JSON.stringify(document)).toContain('"opaque":true');
		expect(document.diagnostics.some((d) => d.code === "zod.check.opaque")).toBe(true);
		expect(calls).toBe(0);
	});
});
