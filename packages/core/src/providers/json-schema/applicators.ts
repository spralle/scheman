import type { Applicators } from "../../document/nodes.js";
import { pointer } from "../../document/reader.js";
import type { NodeRef } from "../../document/types.js";
import { objectEntries } from "./reader.js";
import type { JsonReader } from "./types.js";

const singles = ["if", "then", "else", "not", "contains", "propertyNames"] as const;

export function applicators(source: object, path: string, reader: JsonReader): Applicators {
	const result: Partial<Record<(typeof singles)[number], NodeRef>> = {};
	for (const key of singles) {
		if (reader.has(source, key)) result[key] = reader.visit(reader.read(source, key, path), pointer(path, key));
	}
	const patternProperties = named(source, "patternProperties", path, reader);
	const dependentSchemas = named(
		source,
		reader.dialect === "draft-07" ? "dependencies" : "dependentSchemas",
		path,
		reader,
	);
	return { ...result, patternProperties, dependentSchemas };
}

function named(source: object, key: string, path: string, reader: JsonReader): Record<string, NodeRef> {
	const result: Record<string, NodeRef> = Object.create(null);
	if (!reader.has(source, key)) return result;
	const location = pointer(path, key);
	for (const [name, child] of objectEntries(reader.read(source, key, path), location, reader)) {
		if (key === "dependencies" && Array.isArray(child)) continue;
		result[name] = reader.visit(child, pointer(location, name));
	}
	return result;
}
