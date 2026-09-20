import { describe, expect, it } from "vitest";
import * as core from "../index.js";

describe("v2 public contract", () => {
	it("exposes explicit providers, not the old walker or internal sessions", () => {
		for (const name of [
			"ingestSchema",
			"extractFromJsonSchema",
			"extractFromZod",
			"extractFromZodV4",
			"registerExtractor",
			"clearExtractorRegistry",
			"findExtractor",
			"createValidationOnlyResult",
			"dereferenceSchema",
			"isJsonSchema",
			"isZodSchema",
			"isZodV4Schema",
			"JsonSession",
			"DocumentBuilder",
		]) {
			expect(core).not.toHaveProperty(name);
		}
		expect(core.ingestSchemaDocument(true, { provider: core.jsonSchemaProvider() }).document.formatVersion).toBe(1);
	});
	it("inspects only passive official Standard contracts", () => {
		let calls = 0;
		const getter = {
			get "~standard"() {
				calls++;
				return {};
			},
		};
		for (const value of [
			getter,
			null,
			undefined,
			42,
			{ "~standard": null },
			{ "~standard": { version: 1, vendor: "x" } },
		]) {
			expect(core.isStandardSchema(value)).toBe(false);
		}
		expect(calls).toBe(0);
		expect(core.isStandardSchema({ "~standard": { version: 1, vendor: "x", validate: () => ({ value: 1 }) } })).toBe(
			true,
		);
	});
	it("retains utility and error behavior independently of ingestion", () => {
		expect(core.isObject({})).toBe(true);
		expect(core.isObject([])).toBe(false);
		expect(core.checkType("integer", 1.5)).toBe(false);
		expect(core.checkType("null", null)).toBe(true);
		expect(() => core.ingestSchemaDocument({}, { provider: undefined as never })).toThrow(core.SchemaError);
	});
});
