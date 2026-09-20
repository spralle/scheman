import type { StandardJSONSchemaV1, StandardSchemaV1 } from "@standard-schema/spec";
import { expect, it, vi } from "vitest";
import type { Side } from "../document/types.js";
import { SchemaError } from "../errors.js";
import { ingestSchemaDocument } from "../ingest-document.js";
import { standardJsonSchemaProvider } from "../providers/standard-json-schema.js";

function schema(converter: StandardJSONSchemaV1.Converter): StandardJSONSchemaV1 {
	return { "~standard": { version: 1, vendor: "fixture", jsonSchema: converter } };
}

it("does not probe conversion on invalid official contracts or contract getters", () => {
	const forbidden = vi.fn(() => {
		throw new Error("forbidden");
	});
	const provider = standardJsonSchemaProvider({ target: "draft-07", execution: "allow" });
	const invalid = {
		"~standard": { version: 2, vendor: "fixture", jsonSchema: { input: forbidden, output: forbidden } },
	};
	expect(ingestSchemaDocument(invalid, { provider }).document.capabilities).toEqual({
		input: "unavailable",
		output: "unavailable",
	});
	const accessor = {
		get "~standard"() {
			return forbidden();
		},
	};
	expect(ingestSchemaDocument(accessor, { provider }).document.capabilities).toEqual({
		input: "unavailable",
		output: "unavailable",
	});
	expect(forbidden).not.toHaveBeenCalled();
});

it.each(["draft-07", "draft-2020-12"] as const)(
	"converts both sides once with the official target and original receiver (%s)",
	(target) => {
		const libraryOptions = { option: "value" };
		const converter = {
			input: vi.fn(function (this: unknown, options: StandardJSONSchemaV1.Options) {
				expect(this).toBe(converter);
				expect(options).toEqual({ target, libraryOptions });
				return { type: "string", description: "input only" };
			}),
			output: vi.fn(function (this: unknown, options: StandardJSONSchemaV1.Options) {
				expect(this).toBe(converter);
				expect(options).toEqual({ target, libraryOptions });
				return { type: "number", description: "output only" };
			}),
		};
		const source = schema(converter);
		const { document, validator } = ingestSchemaDocument(source, {
			provider: standardJsonSchemaProvider({ target, execution: "allow", libraryOptions }),
		});
		expect(validator).toBeUndefined();
		expect(converter.input).toHaveBeenCalledTimes(1);
		expect(converter.output).toHaveBeenCalledTimes(1);
		expect(document.nodes[document.root.input.nodeId]).toMatchObject({
			kind: "primitive",
			type: "string",
			metadata: { annotations: { description: "input only" } },
		});
		expect(document.nodes[document.root.output.nodeId]).toMatchObject({
			kind: "primitive",
			type: "number",
			metadata: { annotations: { description: "output only" } },
		});
		expect(document.capabilities).toEqual({ input: "complete", output: "complete" });
		expect(Object.isFrozen(source)).toBe(false);
		expect(Object.isFrozen(libraryOptions)).toBe(false);
	},
);

it("never converts when execution is denied", () => {
	const input = vi.fn(() => ({ type: "string" }));
	const output = vi.fn(() => ({ type: "number" }));
	const { document } = ingestSchemaDocument(schema({ input, output }), {
		provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "deny" }),
	});
	expect(input).not.toHaveBeenCalled();
	expect(output).not.toHaveBeenCalled();
	expect(document.capabilities).toEqual({ input: "unavailable", output: "unavailable" });
	expect(document.nodes[document.root.input.nodeId].kind).toBe("unknown");
	expect(document.nodes[document.root.output.nodeId].kind).toBe("unknown");
});

it.each([
	{},
	{ execution: "allow" },
	{ target: "draft-07" },
	{ target: "", execution: "allow" },
	{ target: "draft-07", execution: true },
])("rejects invalid converter options %j", (options) => {
	expect(() => standardJsonSchemaProvider(options as never)).toThrow(SchemaError);
});

it.each(["input", "output"] as const)(
	"keeps the other side when %s conversion throws without inspecting vendor errors",
	(failedSide) => {
		const forbidden = vi.fn();
		const thrown = {
			toString: forbidden,
			get message() {
				return forbidden();
			},
		};
		const convert = (side: Side) =>
			vi.fn(() => {
				if (side === failedSide) throw thrown;
				return { type: "string", "x-side": side };
			});
		const converter = { input: convert("input"), output: convert("output") };
		const { document } = ingestSchemaDocument(schema(converter), {
			provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow" }),
		});
		const successfulSide = failedSide === "input" ? "output" : "input";
		expect(document.capabilities[failedSide]).toBe("unavailable");
		expect(document.capabilities[successfulSide]).toBe("complete");
		expect(document.nodes[document.root[failedSide].nodeId].kind).toBe("unknown");
		expect(document.nodes[document.root[successfulSide].nodeId]).toMatchObject({
			kind: "primitive",
			type: "string",
			metadata: { extensions: { "x-side": successfulSide } },
		});
		expect(converter.input).toHaveBeenCalledTimes(1);
		expect(converter.output).toHaveBeenCalledTimes(1);
		expect(forbidden).not.toHaveBeenCalled();
	},
);

it("retains validation separately without executing validation or defaults", () => {
	const forbidden = vi.fn(() => {
		throw new Error("must not execute");
	});
	const converted = { type: "object", properties: { field: { type: "string", default: forbidden } } };
	const source: StandardJSONSchemaV1 & StandardSchemaV1 = {
		"~standard": {
			version: 1,
			vendor: "fixture",
			validate: forbidden,
			jsonSchema: { input: () => converted, output: () => converted },
		},
	};
	const result = ingestSchemaDocument(source, {
		provider: standardJsonSchemaProvider({ target: "draft-07", execution: "allow" }),
	});
	expect(result.validator).toBe(source);
	expect(forbidden).not.toHaveBeenCalled();
	expect(Object.isFrozen(converted.properties.field)).toBe(false);
	expect(() => JSON.stringify(result.document)).not.toThrow();
});

it("does not invoke generic contract or converter getters", () => {
	const forbidden = vi.fn();
	const source = {
		"~standard": {
			version: 1,
			vendor: "fixture",
			jsonSchema: {
				get input() {
					return forbidden();
				},
				output: () => ({ type: "number" }),
			},
		},
	};
	const { document } = ingestSchemaDocument(source, {
		provider: standardJsonSchemaProvider({ target: "draft-07", execution: "allow" }),
	});
	expect(document.capabilities).toEqual({ input: "unavailable", output: "complete" });
	expect(forbidden).not.toHaveBeenCalled();
	expect(() =>
		standardJsonSchemaProvider({
			target: "draft-07",
			execution: "allow",
			get libraryOptions() {
				return forbidden();
			},
		}),
	).toThrow(SchemaError);
	expect(forbidden).not.toHaveBeenCalled();
});

it.each([null, false, "schema", [], new Date(), Promise.resolve({ type: "string" })])(
	"diagnoses invalid synchronous conversion result %j independently",
	(value) => {
		const source = schema({ input: (() => value) as never, output: () => ({ type: "number" }) });
		const { document } = ingestSchemaDocument(source, {
			provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow" }),
		});
		expect(document.capabilities).toEqual({ input: "unavailable", output: "complete" });
		expect(document.diagnostics.some((item) => item.code === "STANDARD_JSON_INVALID_RESULT")).toBe(true);
	},
);

it("isolates references, definitions, and metadata across converted sides", () => {
	const source = schema({
		input: () => ({ $ref: "#/$defs/value", $defs: { value: { type: "string" } }, "x-side": "input" }),
		output: () => ({ $ref: "#/$defs/value", $defs: { value: { type: "number" } }, "x-side": "output" }),
	});
	const { document } = ingestSchemaDocument(source, {
		provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow" }),
	});
	for (const side of ["input", "output"] as const) {
		const root = document.nodes[document.root[side].nodeId];
		if (root.kind !== "ref" || !root.target) throw new Error("fixture");
		expect(document.nodes[root.target.nodeId]).toMatchObject({ type: side === "input" ? "string" : "number" });
		expect(root.metadata).toMatchObject({ extensions: { "x-side": side } });
	}
	expect(document.definitions).toHaveLength(2);
});

it("does not contaminate output capability with input-only index diagnostics", () => {
	const source = schema({
		input: () => ({
			type: "string",
			$defs: {
				get unreadable() {
					throw new Error("never read");
				},
			},
		}),
		output: () => ({ type: "number" }),
	});
	const { document } = ingestSchemaDocument(source, {
		provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow" }),
	});
	expect(document.capabilities).toEqual({ input: "partial", output: "complete" });
	expect(document.diagnostics.every((item) => item.side === "input")).toBe(true);
});

it("forwards non-core official targets while diagnosing unsupported graph fidelity", () => {
	const input = vi.fn(() => ({ type: "string", nullable: true }));
	const output = vi.fn(() => ({ type: "number" }));
	const { document } = ingestSchemaDocument(schema({ input, output }), {
		provider: standardJsonSchemaProvider({ target: "openapi-3.0", execution: "allow" }),
	});
	expect(input).toHaveBeenCalledWith({ target: "openapi-3.0" });
	expect(output).toHaveBeenCalledWith({ target: "openapi-3.0" });
	expect(document.capabilities).toEqual({ input: "partial", output: "partial" });
	expect(document.nodes[document.root.input.nodeId].metadata).toMatchObject({ unsupported: { nullable: true } });
});

it("honors global limits across both converter sides", () => {
	const input = vi.fn(() => ({ type: "object", properties: { self: { $ref: "#" } }, $defs: { a: true, b: false } }));
	const output = vi.fn(() => ({ type: "array", items: { $ref: "#" } }));
	const { document } = ingestSchemaDocument(schema({ input, output }), {
		provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow" }),
		limits: { maxNodes: 5, maxDefinitions: 1, maxDiagnostics: 2 },
	});
	expect(Object.keys(document.nodes).length).toBeLessThanOrEqual(5);
	expect(document.definitions.length).toBeLessThanOrEqual(1);
	expect(document.diagnostics.length).toBeLessThanOrEqual(2);
	expect(input).toHaveBeenCalledTimes(1);
	expect(output).toHaveBeenCalledTimes(1);
	expect(() => JSON.stringify(document)).not.toThrow();
});
