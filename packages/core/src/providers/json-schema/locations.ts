import { data, entries, isReference, pointer } from "../../document/reader.js";
import { schemaObject } from "./reader.js";
import type { IndexedDefinition, JsonSchemaDialect, Location } from "./types.js";

const maps = ["properties", "patternProperties"];
const singles = ["additionalProperties", "contains", "propertyNames", "not", "if", "then", "else"];
const lists = ["allOf", "oneOf", "anyOf"];
export interface ScanContext {
	diagnose(code: string, path: string): void;
	take(path: string): boolean;
	definition(entry: IndexedDefinition): void;
	read(source: unknown, key: string | number, path: string): unknown;
}

export function* children(location: Location, context: ScanContext, dialect: JsonSchemaDialect): Generator<Location> {
	const legacy = dialect === "draft-07";
	const dialectMaps = legacy ? ["definitions", "dependencies"] : ["$defs", "definitions", "dependentSchemas"];
	for (const key of [...maps, ...dialectMaps]) yield* mapChildren(location, key, context);
	for (const key of [...lists, legacy ? "items" : "prefixItems"]) yield* listChildren(location, key, context);
	const extra = legacy ? ["additionalItems"] : ["items", "unevaluatedProperties", "unevaluatedItems", "contentSchema"];
	for (const key of [...singles, ...extra]) {
		const source = context.read(location.source, key, location.pointer);
		if (source === undefined) continue;
		if (!context.take(location.pointer)) return;
		yield { source, pointer: pointer(location.pointer, key), rebased: location.rebased };
	}
}

function* mapChildren(location: Location, key: string, context: ScanContext): Generator<Location> {
	const map = context.read(location.source, key, location.pointer);
	if (!schemaObject(map)) {
		if (map !== undefined) context.diagnose("JSON_INVALID_KEYWORD", pointer(location.pointer, key));
		return;
	}
	const path = pointer(location.pointer, key);
	for (const [name] of entries(map)) {
		if (!context.take(path)) return;
		const source = context.read(map, name, path);
		if (key === "dependencies" && Array.isArray(source)) continue;
		const child = { source, pointer: pointer(path, name), rebased: location.rebased };
		if (key === "$defs" || key === "definitions") context.definition({ ...child, name });
		yield child;
	}
}

function* listChildren(location: Location, key: string, context: ScanContext): Generator<Location> {
	const list = context.read(location.source, key, location.pointer);
	const path = pointer(location.pointer, key);
	if (!Array.isArray(list)) {
		if (key === "items" && list !== undefined && context.take(path))
			yield { source: list, pointer: path, rebased: location.rebased };
		return;
	}
	const length = data(list, "length") as number;
	for (let index = 0; index < length; index++) {
		if (!context.take(path)) return;
		yield { source: context.read(list, index, path), pointer: pointer(path, index), rebased: location.rebased };
	}
}

export function localAnchor(source: unknown, dialect: JsonSchemaDialect): string | undefined {
	if (referenceOnly(source, dialect)) return undefined;
	const value = data(source, dialect === "draft-07" ? "$id" : "$anchor");
	if (typeof value !== "string") return undefined;
	const name = dialect === "draft-07" && value.startsWith("#") ? value.slice(1) : value;
	if (dialect === "draft-07" && !value.startsWith("#")) return undefined;
	const pattern = dialect === "draft-07" ? /^[A-Za-z][-A-Za-z0-9._:]*$/ : /^[A-Za-z_][-A-Za-z0-9._]*$/;
	return pattern.test(name) ? name : undefined;
}

export function referenceOnly(source: unknown, dialect: JsonSchemaDialect): boolean {
	return dialect === "draft-07" && isReference(source) && Object.hasOwn(source, "$ref");
}

export function changesResource(source: unknown, path: string, dialect: JsonSchemaDialect): boolean {
	if (!path) return false;
	if (referenceOnly(source, dialect)) return false;
	if (source && typeof source === "object") {
		const descriptor = Object.getOwnPropertyDescriptor(source, "$id");
		if (descriptor && !("value" in descriptor)) return true;
	}
	const id = data(source, "$id");
	return id !== undefined && id !== "" && id !== "#" && !(dialect === "draft-07" && localAnchor(source, dialect));
}
