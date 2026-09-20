import { data, entries } from "../../document/reader.js";
import type { OwnedValue } from "../../document/types.js";
import { checkValue } from "./check-values.js";
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
	const raw = data(definition, "checks");
	const evidence: unknown[] = [];
	if (Array.isArray(raw)) {
		for (let index = 0; index < raw.length && state.take(); index++) {
			const check = data(raw, index);
			evidence.push(checkEvidence(state.reader.version === 3 ? check : data(data(check, "_zod"), "def"), state));
		}
	}
	if (evidence.length) result.checks = evidence;
	for (const key of ["minLength", "maxLength", "exactLength", "format"]) {
		const value = data(definition, key);
		if (value !== undefined && value !== null) result[key] = value;
	}
	return state.context.copy(result, state.side, state.path);
}
function checkEvidence(definition: unknown, state: Walk): unknown {
	const kind = data(definition, state.reader.version === 3 ? "kind" : "check");
	const result: Record<string, unknown> = Object.create(null);
	if (typeof kind !== "string" || !known.has(kind)) {
		state.partial("zod.check.opaque");
		result.opaque = true;
		result.unsupported = state.context.copy(definition, state.side, state.path);
	}
	for (const [key, value] of entries(definition)) {
		if (!state.take()) break;
		if (fields.has(key)) result[key] = checkValue(value);
	}
	return result;
}
