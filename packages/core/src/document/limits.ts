import { SchemaError } from "../errors.js";

export const defaultLimits = Object.freeze({
	maxDepth: 128,
	maxNodes: 10000,
	maxDefinitions: 2000,
	maxDiagnostics: 200,
	maxEdges: 50000,
	maxMetadataEntries: 20000,
	maxMetadataBytes: 1048576,
});
export type DocumentLimits = { -readonly [Key in keyof typeof defaultLimits]: number };
export type LimitOptions = Partial<DocumentLimits>;
const ceilings: DocumentLimits = {
	maxDepth: 256,
	maxNodes: 100000,
	maxDefinitions: 20000,
	maxDiagnostics: 2000,
	maxEdges: 500000,
	maxMetadataEntries: 200000,
	maxMetadataBytes: 16777216,
};

export function resolveLimits(value: unknown): DocumentLimits {
	if (value === undefined) return { ...defaultLimits };
	if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
	const result: DocumentLimits = { ...defaultLimits };
	for (const key of Reflect.ownKeys(value as object)) {
		if (!Object.hasOwn(defaultLimits, key)) invalid();
		const descriptor = Object.getOwnPropertyDescriptor(value, key);
		if (!descriptor || !("value" in descriptor)) invalid();
		const item = descriptor.value;
		const name = key as keyof DocumentLimits;
		if (!Number.isSafeInteger(item) || (item as number) < 1 || (item as number) > ceilings[name]) invalid();
		result[name] = item as number;
	}
	if (result.maxEdges < 2) {
		throw new SchemaError("SCHEMA_INVALID_OPTIONS", "maxEdges must allow the two mandatory root edges");
	}
	return result;
}

function invalid(): never {
	throw new SchemaError("SCHEMA_INVALID_OPTIONS", "Limits must be known positive integers within safe ceilings");
}
