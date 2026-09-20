import { data, entries } from "../../document/reader.js";
import type { OwnedValue } from "../../document/types.js";
import { checkValue } from "./check-values.js";
import { evidence, observed } from "./evidence.js";
import type { Walk } from "./types.js";

const known = new Set([
	"min",
	"max",
	"length",
	"int",
	"finite",
	"multipleOf",
	"email",
	"url",
	"uuid",
	"cuid",
	"cuid2",
	"ulid",
	"emoji",
	"regex",
	"includes",
	"startsWith",
	"endsWith",
	"datetime",
	"date",
	"time",
	"duration",
	"ip",
	"cidr",
	"base64",
	"base64url",
	"jwt",
	"nanoid",
	"greater_than",
	"less_than",
	"multiple_of",
	"number_format",
	"bigint_format",
	"min_length",
	"max_length",
	"length_equals",
	"min_size",
	"max_size",
	"size_equals",
	"string_format",
]);
const fields = new Set([
	"kind",
	"check",
	"value",
	"minimum",
	"maximum",
	"length",
	"size",
	"inclusive",
	"divisor",
	"format",
	"pattern",
	"regex",
	"precision",
	"offset",
	"local",
	"position",
	"version",
	"message",
	"abort",
]);

export function checks(definition: unknown, state: Walk): OwnedValue {
	const result: Record<string, unknown> = Object.create(null);
	const items = checkList(definition, state);
	if (items.length) result.checks = items;
	for (const key of ["minLength", "maxLength", "exactLength", "format"]) {
		const value = observed(definition, key, state, "zod.checks-unreadable");
		if (value !== undefined && value !== null) result[key] = value;
	}
	return state.context.copy(result, state.side, state.path);
}
function checkList(definition: unknown, state: Walk): unknown[] {
	const item = evidence(definition, "checks");
	if (item.status === "absent" || (item.status === "value" && item.value === undefined)) return [];
	if (item.status !== "value" || !Array.isArray(item.value)) {
		state.partial("zod.checks-unreadable");
		return [{ opaque: true, reason: "zod.checks-unreadable" }];
	}
	const items: unknown[] = [];
	for (let index = 0; index < item.value.length && state.take(); index++) {
		const check = data(item.value, index);
		items.push(checkEvidence(state.reader.version === 3 ? check : data(data(check, "_zod"), "def"), state));
	}
	return items;
}
function checkEvidence(definition: unknown, state: Walk): unknown {
	const kind = data(definition, state.reader.version === 3 ? "kind" : "check");
	const result: Record<string, unknown> = Object.create(null);
	if (typeof kind !== "string" || !known.has(kind)) {
		state.partial("zod.check.opaque");
		result.opaque = true;
		result.unsupported = state.context.copy(definition, state.side, state.path);
	}
	for (const [key] of entries(definition)) {
		if (!state.take()) break;
		if (!fields.has(key)) continue;
		const item = evidence(definition, key);
		if (item.status !== "value") {
			state.partial("zod.checks-unreadable");
			result.opaque = true;
			result[key] = { status: "unavailable" };
		} else result[key] = checkValue(item.value);
	}
	return result;
}
