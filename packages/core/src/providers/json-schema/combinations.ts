import type { SchemaNode } from "../../document/nodes.js";
import { pointer } from "../../document/reader.js";
import type { NodeRef, OwnedValue } from "../../document/types.js";
import { arrayEntries } from "./reader.js";
import type { JsonReader } from "./types.js";

export function combinations(source: object, path: string, reader: JsonReader): SchemaNode[] {
	const parts: SchemaNode[] = [];
	for (const key of ["allOf", "oneOf", "anyOf"] as const) {
		if (!reader.has(source, key)) continue;
		const branches: NodeRef[] = [];
		for (const [index, child] of arrayEntries(reader.read(source, key, path), pointer(path, key), reader)) {
			branches.push(reader.visit(child, pointer(pointer(path, key), index)));
		}
		parts.push(
			key === "allOf"
				? { kind: "intersection", operands: branches }
				: { kind: "union", semantics: key, alternatives: branches },
		);
	}
	if (reader.has(source, "const"))
		parts.push({ kind: "literal", value: literal(reader.read(source, "const", path), path, reader) });
	if (reader.has(source, "enum")) parts.push(enumeration(source, path, reader));
	return parts;
}

function enumeration(source: object, path: string, reader: JsonReader): SchemaNode {
	const values: OwnedValue[] = [];
	for (const [index, value] of arrayEntries(reader.read(source, "enum", path), pointer(path, "enum"), reader)) {
		values.push(literal(value, pointer(pointer(path, "enum"), index), reader));
	}
	return { kind: "enum", values };
}

function literal(value: unknown, path: string, reader: JsonReader): OwnedValue {
	if (value === undefined || ["function", "bigint", "symbol"].includes(typeof value))
		reader.diagnose("JSON_NON_JSON_LITERAL", path);
	if (typeof value === "number" && !Number.isFinite(value)) reader.diagnose("JSON_NON_JSON_LITERAL", path);
	return reader.context.copy(value, reader.side, path);
}
