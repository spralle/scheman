import type { Primitive, PropertyEdge, SchemaNode } from "../../document/nodes.js";
import { pointer } from "../../document/reader.js";
import type { NodeRef } from "../../document/types.js";
import { arrayEntries, objectEntries } from "./reader.js";
import type { JsonReader } from "./types.js";

const jsonTypes = new Set(["object", "array", "string", "number", "integer", "boolean", "null"]);
const objectKeys = ["properties", "required", "additionalProperties"];
const arrayKeys = ["items", "prefixItems"];

export function typeStructure(source: object, path: string, reader: JsonReader): SchemaNode | undefined {
	const type = reader.read(source, "type", path);
	if (reader.has(source, "type")) return explicitType(type, source, path, reader);
	if (![...objectKeys, ...arrayKeys].some((key) => reader.has(source, key))) return undefined;
	const alternatives = ["null", "boolean", "number", "string", "array", "object"].map((name) =>
		reader.context.node(reader.side, path, () => typed(name, source, path, reader)),
	);
	return { kind: "union", semantics: "anyOf", alternatives };
}

function explicitType(type: unknown, source: object, path: string, reader: JsonReader): SchemaNode {
	if (!Array.isArray(type)) return typed(type, source, path, reader);
	const alternatives: NodeRef[] = [];
	for (const [index, name] of arrayEntries(type, pointer(path, "type"), reader)) {
		alternatives.push(
			reader.context.node(reader.side, pointer(pointer(path, "type"), index), () => typed(name, source, path, reader)),
		);
	}
	if (!alternatives.length) reader.diagnose("JSON_INVALID_KEYWORD", pointer(path, "type"));
	return { kind: "union", semantics: "anyOf", alternatives };
}

function typed(type: unknown, source: object, path: string, reader: JsonReader): SchemaNode {
	if (typeof type !== "string" || !jsonTypes.has(type)) {
		reader.diagnose("JSON_INVALID_TYPE", pointer(path, "type"));
		return { kind: "unknown", reason: "invalid-json-type" };
	}
	if (type === "object") return objectStructure(source, path, reader);
	if (type === "array") return arrayStructure(source, path, reader);
	return { kind: "primitive", type: type as Primitive };
}

function requiredNames(source: object, path: string, reader: JsonReader): string[] {
	if (!reader.has(source, "required")) return [];
	const result: string[] = [];
	for (const [index, name] of arrayEntries(reader.read(source, "required", path), pointer(path, "required"), reader)) {
		if (typeof name === "string") result.push(name);
		else reader.diagnose("JSON_INVALID_KEYWORD", pointer(pointer(path, "required"), index));
	}
	return result;
}

function objectStructure(source: object, path: string, reader: JsonReader): SchemaNode {
	const required = requiredNames(source, path, reader);
	const requiredSet = new Set(required);
	const unknownPresence = reader.has(source, "required") && !Array.isArray(reader.read(source, "required", path));
	const properties: PropertyEdge[] = [];
	if (reader.has(source, "properties")) {
		const location = pointer(path, "properties");
		for (const [name, child] of objectEntries(reader.read(source, "properties", path), location, reader)) {
			properties.push({
				name,
				node: reader.visit(child, pointer(location, name)),
				presence: presence(unknownPresence, requiredSet, name),
			});
		}
	}
	const additional = reader.has(source, "additionalProperties")
		? reader.read(source, "additionalProperties", path)
		: true;
	const unknownKeys = additional === false ? "reject" : additional === true ? "passthrough" : "schema";
	return {
		kind: "object",
		properties,
		required,
		unknownKeys,
		additionalProperties: reader.visit(additional, pointer(path, "additionalProperties")),
	};
}

function presence(unknown: boolean, required: ReadonlySet<string>, name: string): PropertyEdge["presence"] {
	if (unknown) return "unknown";
	return required.has(name) ? "required" : "optional";
}

function arrayStructure(source: object, path: string, reader: JsonReader): SchemaNode {
	const key = reader.dialect === "draft-07" ? "items" : "prefixItems";
	const prefix = reader.read(source, key, path);
	if (Array.isArray(prefix)) return tupleStructure(source, prefix, key, path, reader);
	if (key === "prefixItems" && reader.has(source, key)) reader.diagnose("JSON_INVALID_KEYWORD", pointer(path, key));
	const items = reader.has(source, "items") ? reader.read(source, "items", path) : true;
	return { kind: "array", items: reader.visit(items, pointer(path, "items")) };
}

function tupleStructure(source: object, prefix: unknown[], key: string, path: string, reader: JsonReader): SchemaNode {
	const items: NodeRef[] = [];
	for (const [index, child] of arrayEntries(prefix, pointer(path, key), reader))
		items.push(reader.visit(child, pointer(pointer(path, key), index)));
	const restKey = reader.dialect === "draft-07" ? "additionalItems" : "items";
	const rest = reader.has(source, restKey) ? reader.read(source, restKey, path) : true;
	return { kind: "tuple", items, rest: reader.visit(rest, pointer(path, restKey)) };
}
