import { describe, expect, it } from "vitest";
import { SchemaError } from "../errors.js";
import { mergeMetadata, mergeSamePrecedence, structuralEqual } from "../metadata-merge.js";

describe("mergeMetadata", () => {
	it("returns empty object for empty input", () => {
		expect(mergeMetadata({})).toEqual({});
	});

	it("returns kernelDefaults as-is when only source", () => {
		expect(mergeMetadata({ kernelDefaults: { a: 1 } })).toEqual({ a: 1 });
	});

	it("merges two non-conflicting sources", () => {
		expect(mergeMetadata({ kernelDefaults: { a: 1 }, embedded: { b: 2 } })).toEqual({ a: 1, b: 2 });
	});

	it("higher precedence wins for overlapping keys", () => {
		expect(
			mergeMetadata({
				kernelDefaults: { x: "low" },
				embedded: { x: "mid" },
				external: { x: "high" },
			}),
		).toEqual({ x: "high" });
	});

	it("deep merges nested objects", () => {
		expect(
			mergeMetadata({
				kernelDefaults: { nested: { a: 1, b: 2 } },
				external: { nested: { b: 3, c: 4 } },
			}),
		).toEqual({ nested: { a: 1, b: 3, c: 4 } });
	});

	it("higher precedence replaces entire array", () => {
		expect(
			mergeMetadata({
				kernelDefaults: { arr: [1, 2] },
				external: { arr: [3] },
			}),
		).toEqual({ arr: [3] });
	});

	it("null in higher precedence overrides lower", () => {
		expect(
			mergeMetadata({
				kernelDefaults: { a: "value" },
				external: { a: null },
			}),
		).toEqual({ a: null });
	});

	it("undefined in higher precedence preserves lower value", () => {
		expect(
			mergeMetadata({
				kernelDefaults: { a: "keep" },
				external: { a: undefined },
			}),
		).toEqual({ a: "keep" });
	});
});

describe("mergeSamePrecedence", () => {
	it("merges non-overlapping keys", () => {
		expect(mergeSamePrecedence({ a: 1 }, { b: 2 })).toEqual({ a: 1, b: 2 });
	});

	it("dedupes same scalar value", () => {
		expect(mergeSamePrecedence({ a: 1 }, { a: 1 })).toEqual({ a: 1 });
	});

	it("dedupes structurally equal objects", () => {
		expect(mergeSamePrecedence({ a: { x: 1 } }, { a: { x: 1 } })).toEqual({ a: { x: 1 } });
	});

	it("dedupes structurally equal arrays", () => {
		expect(mergeSamePrecedence({ a: [1, 2] }, { a: [1, 2] })).toEqual({ a: [1, 2] });
	});

	it("throws SCHEMA_META_CONFLICT for different scalars", () => {
		expect(() => mergeSamePrecedence({ a: 1 }, { a: 2 })).toThrow(SchemaError);
		try {
			mergeSamePrecedence({ a: 1 }, { a: 2 });
		} catch (e) {
			expect((e as SchemaError).code).toBe("SCHEMA_META_CONFLICT");
		}
	});

	it("throws SCHEMA_META_CONFLICT for different arrays", () => {
		expect(() => mergeSamePrecedence({ a: [1] }, { a: [2] })).toThrow(SchemaError);
		try {
			mergeSamePrecedence({ a: [1] }, { a: [2] });
		} catch (e) {
			expect((e as SchemaError).code).toBe("SCHEMA_META_CONFLICT");
		}
	});

	it("throws SCHEMA_META_CONFLICT for nested sub-conflicts", () => {
		expect(() => mergeSamePrecedence({ nested: { x: 1 } }, { nested: { x: 2 } })).toThrow(SchemaError);
	});
});

describe("structuralEqual", () => {
	it("same primitives are equal", () => {
		expect(structuralEqual(1, 1)).toBe(true);
		expect(structuralEqual("a", "a")).toBe(true);
		expect(structuralEqual(true, true)).toBe(true);
	});

	it("different primitives are not equal", () => {
		expect(structuralEqual(1, 2)).toBe(false);
		expect(structuralEqual("a", "b")).toBe(false);
	});

	it("null vs null is true", () => {
		expect(structuralEqual(null, null)).toBe(true);
	});

	it("null vs object is false", () => {
		expect(structuralEqual(null, {})).toBe(false);
	});

	it("same arrays are equal", () => {
		expect(structuralEqual([1, 2, 3], [1, 2, 3])).toBe(true);
	});

	it("different length arrays are not equal", () => {
		expect(structuralEqual([1, 2], [1, 2, 3])).toBe(false);
	});

	it("different content arrays are not equal", () => {
		expect(structuralEqual([1, 2], [1, 3])).toBe(false);
	});

	it("same nested objects are equal", () => {
		expect(structuralEqual({ a: { b: 1 } }, { a: { b: 1 } })).toBe(true);
	});

	it("different nested objects are not equal", () => {
		expect(structuralEqual({ a: { b: 1 } }, { a: { b: 2 } })).toBe(false);
	});

	it("empty objects are equal", () => {
		expect(structuralEqual({}, {})).toBe(true);
	});

	it("object vs array is false", () => {
		expect(structuralEqual({}, [])).toBe(false);
	});
});
