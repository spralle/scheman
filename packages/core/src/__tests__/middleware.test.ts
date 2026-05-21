import { describe, expect, test } from "vitest";
import type { JsonSchema } from "../adapters/json-schema-types.js";
import type { SchemaMiddleware } from "../middleware.js";
import { applySchemaMiddleware } from "../middleware.js";

describe("applySchemaMiddleware", () => {
  test("composes 3 middlewares left-to-right", () => {
    const addTitle: SchemaMiddleware = (s) => ({ ...s, title: "Hello" });
    const addDescription: SchemaMiddleware = (s) => ({ ...s, description: "World" });
    const addFormat: SchemaMiddleware = (s) => ({
      ...s,
      properties: { ...s.properties, added: { type: "string", format: "email" } },
    });

    const base: JsonSchema = { type: "object", properties: {} };
    const result = applySchemaMiddleware(base, [addTitle, addDescription, addFormat]);

    expect(result.title).toBe("Hello");
    expect(result.description).toBe("World");
    expect(result.properties?.added?.format).toBe("email");
  });

  test("returns original schema when no middlewares", () => {
    const base: JsonSchema = { type: "string" };
    const result = applySchemaMiddleware(base, []);
    expect(result).toBe(base);
  });

  test("middlewares execute in order (later overrides earlier)", () => {
    const first: SchemaMiddleware = (s) => ({ ...s, title: "first" });
    const second: SchemaMiddleware = (s) => ({ ...s, title: "second" });

    const result = applySchemaMiddleware({ type: "object" }, [first, second]);
    expect(result.title).toBe("second");
  });
});
