import { entries, pointer } from "../../document/reader.js";
import type { OwnedValue } from "../../document/types.js";
import type { JsonReader } from "./types.js";

const annotations = new Set([
	"$schema",
	"$id",
	"$anchor",
	"$ref",
	"$comment",
	"title",
	"description",
	"default",
	"examples",
	"readOnly",
	"writeOnly",
	"deprecated",
]);
const constraints = new Set([
	"minimum",
	"maximum",
	"exclusiveMinimum",
	"exclusiveMaximum",
	"multipleOf",
	"minLength",
	"maxLength",
	"pattern",
	"format",
	"minItems",
	"maxItems",
	"uniqueItems",
	"minProperties",
	"maxProperties",
	"contentEncoding",
	"contentMediaType",
]);
const structural = new Set([
	"type",
	"properties",
	"required",
	"items",
	"additionalProperties",
	"enum",
	"const",
	"allOf",
	"oneOf",
	"anyOf",
	"$ref",
	"definitions",
	"if",
	"then",
	"else",
	"not",
	"contains",
	"propertyNames",
	"patternProperties",
]);
const modern = new Set(["$defs", "prefixItems", "dependentSchemas", "dependentRequired", "minContains", "maxContains"]);
const legacy = new Set(["additionalItems", "dependencies"]);

export interface KeywordData {
	readonly metadata: OwnedValue;
	readonly constraints: OwnedValue;
}
type Bucket = "annotations" | "extensions" | "unsupported" | "bounds";

export function keywords(source: object, path: string, reader: JsonReader): KeywordData {
	if (Object.getOwnPropertySymbols(source).length) reader.diagnose("JSON_SYMBOL_KEY_UNSUPPORTED", path);
	const buckets: Record<Bucket, Record<string, unknown>> = {
		annotations: Object.create(null),
		extensions: Object.create(null),
		unsupported: Object.create(null),
		bounds: Object.create(null),
	};
	const ignoredSiblings: Record<string, unknown> = Object.create(null);
	const refOnly = reader.dialect === "draft-07" && reader.has(source, "$ref");
	for (const [key] of entries(source)) {
		if (!reader.take(path)) break;
		const value = reader.read(source, key, path);
		if (refOnly && key !== "$ref") ignoredSiblings[key] = value;
		const group = keywordGroup(key, reader);
		if (group) {
			buckets[group][key] = value;
			if (group === "unsupported") reader.diagnose("JSON_UNSUPPORTED_KEYWORD", pointer(path, key));
		}
	}
	if (reader.dialect === "draft-07") legacyRequired(source, path, reader, buckets.bounds);
	return {
		metadata: reader.context.copy(
			{
				annotations: buckets.annotations,
				extensions: buckets.extensions,
				unsupported: buckets.unsupported,
				ignoredSiblings,
			},
			reader.side,
			path,
		),
		constraints: reader.context.copy(buckets.bounds, reader.side, path),
	};
}

function supported(key: string, reader: JsonReader): boolean {
	return structural.has(key) || (reader.dialect === "draft-07" ? legacy : modern).has(key);
}

function keywordGroup(key: string, reader: JsonReader): Bucket | undefined {
	if (annotations.has(key) && !(reader.dialect === "draft-07" && key === "$anchor")) return "annotations";
	if (
		constraints.has(key) ||
		(reader.dialect === "draft-2020-12" && ["dependentRequired", "minContains", "maxContains"].includes(key))
	)
		return "bounds";
	if (key.startsWith("x-")) return "extensions";
	if (!supported(key, reader)) return "unsupported";
	return undefined;
}

function legacyRequired(source: object, path: string, reader: JsonReader, bounds: Record<string, unknown>): void {
	const dependencies = reader.read(source, "dependencies", path);
	const required: Record<string, unknown> = Object.create(null);
	for (const [key, value] of entries(dependencies)) {
		if (!reader.take(path)) break;
		if (Array.isArray(value)) required[key] = value;
	}
	if (Object.keys(required).length) bounds.dependentRequired = required;
}
