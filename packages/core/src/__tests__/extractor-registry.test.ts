import { beforeEach, describe, expect, it } from "vitest";
import {
	type SchemaExtractor,
	clearExtractorRegistry,
	createValidationOnlyResult,
	findExtractor,
	registerExtractor,
} from "../extractor-registry.js";
import type { SchemaFieldInfo, StandardSchemaV1 } from "../types.js";

describe("extractor-registry", () => {
	beforeEach(() => {
		clearExtractorRegistry();
	});

	it("findExtractor returns undefined when registry is empty", () => {
		expect(findExtractor({})).toBeUndefined();
	});

	it("finds a registered extractor", () => {
		const extractor: SchemaExtractor = {
			vendor: "test",
			canExtract: () => true,
			extract: () => [],
		};
		registerExtractor(extractor);
		expect(findExtractor({})).toBe(extractor);
	});

	it("returns first extractor where canExtract is true", () => {
		const first: SchemaExtractor = {
			vendor: "first",
			canExtract: () => false,
			extract: () => [],
		};
		const second: SchemaExtractor = {
			vendor: "second",
			canExtract: () => true,
			extract: () => [{ path: "field", type: "string", required: true } as SchemaFieldInfo],
		};
		registerExtractor(first);
		registerExtractor(second);
		expect(findExtractor({})).toBe(second);
	});

	it("clearExtractorRegistry empties the registry", () => {
		registerExtractor({ vendor: "x", canExtract: () => true, extract: () => [] });
		clearExtractorRegistry();
		expect(findExtractor({})).toBeUndefined();
	});

	it("createValidationOnlyResult returns correct shape", () => {
		const schema = {
			"~standard": { vendor: "my-vendor", version: 1, validate: () => ({ value: {} }) },
		} as StandardSchemaV1;
		const result = createValidationOnlyResult(schema);
		expect(result.fields).toEqual([]);
		expect(result.metadata).toEqual({ vendor: "my-vendor", validationOnly: true });
	});

	it("extractors are checked in registration order", () => {
		const order: string[] = [];
		const makeExtractor = (name: string, match: boolean): SchemaExtractor => ({
			vendor: name,
			canExtract: () => {
				order.push(name);
				return match;
			},
			extract: () => [],
		});
		registerExtractor(makeExtractor("a", false));
		registerExtractor(makeExtractor("b", false));
		registerExtractor(makeExtractor("c", true));
		findExtractor({});
		expect(order).toEqual(["a", "b", "c"]);
	});
});
