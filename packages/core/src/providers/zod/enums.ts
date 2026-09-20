import type { SchemaNode } from "../../document/nodes.js";
import { data, entries, isReference } from "../../document/reader.js";
import { evidence, listValues } from "./evidence.js";
import type { Walk } from "./types.js";

export function enumeration(definition: unknown, kind: string, state: Walk): SchemaNode {
	const raw = data(definition, state.reader.version === 4 ? "entries" : "values");
	const values = kind === "enum" && state.reader.version === 3 ? listValues(raw, state) : enumValues(raw, state);
	if (!values) {
		state.partial("zod.enum-unreadable");
		return { kind: "unknown", reason: "zod.enum-unreadable" };
	}
	return { kind: "enum", values: values.map((value) => state.context.copy(value, state.side, state.path)) };
}

function enumValues(raw: unknown, state: Walk): (string | number)[] | undefined {
	if (!isReference(raw)) return undefined;
	const items: [string, string | number][] = [];
	for (const [key, value] of entries(raw)) {
		if (!state.take() || (typeof value !== "string" && typeof value !== "number")) return undefined;
		items.push([key, value]);
	}
	// V4 removes numeric reverse-entry keys, not strings that happen to name numeric entries.
	const numeric = new Set(
		items.map(([, value]) => value).filter((value) => typeof value === "number" && !Number.isNaN(value)),
	);
	const values: (string | number)[] = [];
	for (const [key, value] of items) {
		if (state.reader.version === 4 && numeric.has(Number(key))) continue;
		if (state.reader.version === 3 && typeof value === "string") {
			const reverse = evidence(raw, value);
			if (reverse.status === "unavailable") return undefined;
			if (reverse.status === "value" && typeof reverse.value === "number") continue;
		}
		if (!values.includes(value)) values.push(value);
	}
	return values;
}
