import type { Primitive, SchemaNode } from "../../document/nodes.js";
import { data, entries, isReference } from "../../document/reader.js";
import type { OwnedValue } from "../../document/types.js";
import type { NodeBuilder, Walk } from "./types.js";

const primitives = new Set([
	"string",
	"number",
	"boolean",
	"null",
	"undefined",
	"void",
	"bigint",
	"symbol",
	"date",
	"nan",
]);
export const scalar: NodeBuilder = (_source, definition, kind, state) => {
	if (primitives.has(kind)) return { kind: "primitive", type: (kind === "nan" ? "NaN" : kind) as Primitive };
	if (kind === "never") return { kind: "never" };
	if (kind === "any" || kind === "unknown") {
		return { kind: "unconstrained", domain: "js" };
	}
	if (kind === "literal") return literal(definition, state);
	if (kind === "enum" || kind === "nativeenum") return enumeration(definition, kind, state);
	return undefined;
};
function literal(definition: unknown, state: Walk): SchemaNode {
	if (state.reader.version === 3) {
		const descriptor = isReference(definition) ? Object.getOwnPropertyDescriptor(definition, "value") : undefined;
		if (!descriptor || !("value" in descriptor)) return unreadable(state);
		return { kind: "literal", value: copy(descriptor.value, state) };
	}
	if (!Array.isArray(data(definition, "values"))) return unreadable(state);
	const values = listValues(data(definition, "values"), state);
	return values.length === 1 ? { kind: "literal", value: values[0] } : { kind: "enum", values };
}
function enumeration(definition: unknown, kind: string, state: Walk): SchemaNode {
	const raw = data(definition, state.reader.version === 4 ? "entries" : "values");
	if (!isReference(raw)) return unreadable(state);
	if (kind === "enum" && state.reader.version === 3 && !Array.isArray(raw)) return unreadable(state);
	if (kind === "enum" && state.reader.version === 3) return { kind: "enum", values: listValues(raw, state) };
	const values: OwnedValue[] = [];
	for (const [, value] of entries(raw)) {
		if (!state.take()) break;
		if (typeof value === "string" && typeof data(raw, value) === "number") continue;
		if (typeof value !== "string" && typeof value !== "number") {
			state.partial("zod.enum-unreadable");
			continue;
		}
		if (!values.includes(value)) values.push(copy(value, state));
	}
	return { kind: "enum", values };
}
function listValues(raw: unknown, state: Walk): OwnedValue[] {
	const values: OwnedValue[] = [];
	if (!Array.isArray(raw)) {
		state.partial("zod.values-unreadable");
		return values;
	}
	for (let index = 0; index < raw.length && state.take(); index++) values.push(copy(data(raw, index), state));
	return values;
}
function copy(value: unknown, state: Walk) {
	return state.context.copy(value, state.side, state.path);
}
function unreadable(state: Walk): SchemaNode {
	state.partial("zod.values-unreadable");
	return { kind: "unknown", reason: "zod.values-unreadable" };
}
