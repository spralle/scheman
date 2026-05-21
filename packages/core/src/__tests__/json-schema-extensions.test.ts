import { describe, expect, test } from "vitest";
import { extractFromJsonSchema } from "../adapters/json-schema-extractor.js";
import type { JsonSchema } from "../adapters/json-schema-types.js";

describe("extractFromJsonSchema x-* extensions", () => {
  test("extracts x-formbar object to extensions.formbar", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        volume: {
          type: "number",
          "x-formbar": { widget: "slider", min: 0, max: 100 },
        },
      },
    };
    const result = extractFromJsonSchema(schema);
    const field = result.fields.find((f) => f.path === "volume");
    expect(field?.metadata?.extensions?.formbar).toEqual({ widget: "slider", min: 0, max: 100 });
  });

  test("extracts x-weaver object to extensions.weaver", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        secret: {
          type: "string",
          "x-weaver": { visibility: "admin", category: "security" },
        },
      },
    };
    const result = extractFromJsonSchema(schema);
    const field = result.fields.find((f) => f.path === "secret");
    expect(field?.metadata?.extensions?.weaver).toEqual({ visibility: "admin", category: "security" });
  });

  test("extracts multiple x-* keys from same property", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: {
          type: "string",
          "x-formbar": { widget: "text" },
          "x-weaver": { visibility: "public" },
        },
      },
    };
    const result = extractFromJsonSchema(schema);
    const field = result.fields.find((f) => f.path === "name");
    expect(field?.metadata?.extensions?.formbar).toEqual({ widget: "text" });
    expect(field?.metadata?.extensions?.weaver).toEqual({ visibility: "public" });
  });

  test("ignores x-* keys with non-object values", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        age: {
          type: "number",
          // Non-object x-* values should be ignored
          "x-deprecated-reason": { note: "use birthdate" } as Record<string, unknown>,
        },
      },
    };
    const result = extractFromJsonSchema(schema);
    const field = result.fields.find((f) => f.path === "age");
    // The object one should be extracted
    expect(field?.metadata?.extensions?.["deprecated-reason"]).toEqual({ note: "use birthdate" });
  });

  test("no extensions when no x-* keys present", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        name: { type: "string", title: "Name" },
      },
    };
    const result = extractFromJsonSchema(schema);
    const field = result.fields.find((f) => f.path === "name");
    expect(field?.metadata?.extensions).toBeUndefined();
  });

  test("preserves standard metadata alongside extensions", () => {
    const schema: JsonSchema = {
      type: "object",
      properties: {
        email: {
          type: "string",
          title: "Email",
          format: "email",
          "x-formbar": { widget: "email-input" },
        },
      },
    };
    const result = extractFromJsonSchema(schema);
    const field = result.fields.find((f) => f.path === "email");
    expect(field?.metadata?.title).toBe("Email");
    expect(field?.metadata?.format).toBe("email");
    expect(field?.metadata?.extensions?.formbar).toEqual({ widget: "email-input" });
  });
});
