import { mergeMetadata } from "../metadata-merge.js";
import type { SchemaFieldMetadata } from "../types.js";

export type ZodDef = Readonly<Record<string, unknown>>;

interface MetadataCarrier {
	readonly meta?: () => unknown;
}

export function readZodMetadata(schema: unknown, def: ZodDef): SchemaFieldMetadata | undefined {
	const carrier = schema as MetadataCarrier;
	const registered = typeof carrier.meta === "function" ? carrier.meta() : undefined;
	const raw = isRecord(registered) ? registered : isRecord(def.metadata) ? def.metadata : undefined;
	const description = typeof def.description === "string" ? def.description : raw?.description;
	const result: Record<string, unknown> = {};

	if (typeof raw?.title === "string") result.title = raw.title;
	if (typeof description === "string") result.description = description;
	// Keep the public extensions contract namespace-shaped; top-level scalars and arrays are not exposed.
	const extensions = raw ? objectValuedEntries(raw) : undefined;
	if (extensions) result.extensions = extensions;

	return Object.keys(result).length ? (result as SchemaFieldMetadata) : undefined;
}

export function mergeZodMetadata(
	lower?: SchemaFieldMetadata,
	higher?: SchemaFieldMetadata,
): SchemaFieldMetadata | undefined {
	if (!lower) return higher;
	if (!higher) return lower;
	return mergeMetadata({
		embedded: lower as unknown as Readonly<Record<string, unknown>>,
		external: higher as unknown as Readonly<Record<string, unknown>>,
	}) as SchemaFieldMetadata;
}

export function zodV3EnumValues(entries: unknown): readonly unknown[] | undefined {
	if (Array.isArray(entries)) return entries.filter(isPrimitive);
	if (!isRecord(entries)) return undefined;

	return Object.keys(entries)
		.filter((key) => typeof entries[String(entries[key])] !== "number")
		.map((key) => entries[key])
		.filter(isPrimitive);
}

export function zodV4EnumValues(entries: unknown): readonly unknown[] | undefined {
	if (!isRecord(entries)) return undefined;
	const numericValues = Object.values(entries).filter((value): value is number => typeof value === "number");
	return Object.entries(entries)
		.filter(([key]) => !numericValues.includes(Number(key)))
		.map(([, value]) => value)
		.filter(isPrimitive);
}

function isPrimitive(value: unknown): value is string | number {
	return typeof value === "string" || typeof value === "number";
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectValuedEntries(
	metadata: Readonly<Record<string, unknown>>,
): Readonly<Record<string, Readonly<Record<string, unknown>>>> | undefined {
	const entries = Object.entries(metadata).filter((entry): entry is [string, Readonly<Record<string, unknown>>] =>
		isRecord(entry[1]),
	);
	return entries.length ? Object.fromEntries(entries) : undefined;
}
