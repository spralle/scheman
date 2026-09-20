import { describe, expect, test } from "vitest";
import type { JsonSchema } from "../index.js";
import type { SchemaMiddleware } from "../middleware.js";
import { applySchemaMiddleware } from "../middleware.js";

describe("applySchemaMiddleware", () => {
	test("composes 3 middlewares left-to-right", () => {
		const addTitle: SchemaMiddleware = (s) => (typeof s === "boolean" ? s : { ...s, title: "Hello" });
		const addDescription: SchemaMiddleware = (s) => (typeof s === "boolean" ? s : { ...s, description: "World" });
		const addFormat: SchemaMiddleware = (s) =>
			typeof s === "boolean"
				? s
				: {
						...s,
						properties: { ...s.properties, added: { type: "string", format: "email" } },
					};

		const base: JsonSchema = { type: "object", properties: {} };
		const result = applySchemaMiddleware(base, [addTitle, addDescription, addFormat]);
		if (typeof result === "boolean") throw new Error("Expected object schema");

		expect(result.title).toBe("Hello");
		expect(result.description).toBe("World");
		expect(result.properties?.added).toEqual({ type: "string", format: "email" });
	});

	test("returns original schema when no middlewares", () => {
		const base: JsonSchema = { type: "string" };
		const result = applySchemaMiddleware(base, []);
		expect(result).toBe(base);
	});

	test("middlewares execute in order (later overrides earlier)", () => {
		const first: SchemaMiddleware = (s) => (typeof s === "boolean" ? s : { ...s, title: "first" });
		const second: SchemaMiddleware = (s) => (typeof s === "boolean" ? s : { ...s, title: "second" });

		const result = applySchemaMiddleware({ type: "object" }, [first, second]);
		if (typeof result === "boolean") throw new Error("Expected object schema");
		expect(result.title).toBe("second");
	});

	test("preserves and intentionally transforms boolean schemas", () => {
		expect(applySchemaMiddleware(false, [])).toBe(false);
		expect(applySchemaMiddleware(true, [(schema) => !schema])).toBe(false);
	});
});
