import { isReference } from "../../document/reader.js";
import type { Walk } from "./types.js";

type Evidence = { readonly status: "value"; readonly value: unknown } | { readonly status: "absent" | "unavailable" };

export function evidence(source: unknown, key: PropertyKey): Evidence {
	const descriptor = isReference(source) ? Object.getOwnPropertyDescriptor(source, key) : undefined;
	if (!descriptor) return { status: "absent" };
	return "value" in descriptor ? { status: "value", value: descriptor.value } : { status: "unavailable" };
}

export function observed(source: unknown, key: PropertyKey, state: Walk, code: string): unknown {
	const item = evidence(source, key);
	if (item.status === "unavailable") state.partial(code);
	return item.status === "value" ? item.value : undefined;
}

export function literalValues(definition: unknown, state: Walk): unknown[] | undefined {
	const item = evidence(definition, state.reader.version === 3 ? "value" : "values");
	if (item.status !== "value") return undefined;
	return state.reader.version === 3 ? [item.value] : listValues(item.value, state);
}

export function listValues(source: unknown, state: Walk): unknown[] | undefined {
	if (!Array.isArray(source)) return undefined;
	const values: unknown[] = [];
	for (let index = 0; index < source.length; index++) {
		if (!state.take()) return undefined;
		const item = evidence(source, String(index));
		if (item.status !== "value") return undefined;
		values.push(item.value);
	}
	return values;
}
