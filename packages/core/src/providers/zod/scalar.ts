import type { Primitive, SchemaNode } from "../../document/nodes.js";
import { enumeration } from "./enums.js";
import { literalValues } from "./evidence.js";
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
	const raw = literalValues(definition, state);
	if (!raw?.length) return unreadable(state);
	const values = raw.map((value) => state.context.copy(value, state.side, state.path));
	return values.length === 1 ? { kind: "literal", value: values[0] } : { kind: "enum", values };
}
function unreadable(state: Walk): SchemaNode {
	state.partial("zod.values-unreadable");
	return { kind: "unknown", reason: "zod.values-unreadable" };
}
