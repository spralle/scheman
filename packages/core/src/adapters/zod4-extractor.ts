import type {
	SchemaFieldInfo,
	SchemaFieldMetadata,
	SchemaFieldType,
	SchemaIngestionResult,
	SchemaMetadata,
} from "../types.js";
import { type ZodDef, mergeZodMetadata, readZodMetadata, zodV4EnumValues } from "./zod-metadata.js";

/**
 * Zod v4 introspection interfaces. v4 replaces `_def` with a `_zod` property
 * containing `def` (schema definition) and `traits` (type markers).
 * When `_zod` is unavailable, we fall back to Standard Schema validation-only mode.
 */
interface ZodV4Internal {
	readonly _zod?: {
		readonly def?: Readonly<Record<string, unknown>>;
		readonly traits?: ReadonlySet<string> | readonly string[];
	};
}

interface WalkContext {
	nullable?: boolean;
	readOnly?: boolean;
	defaultValue?: unknown;
	lowerMetadata?: SchemaFieldMetadata;
	metadata?: SchemaFieldMetadata;
	active: WeakSet<object>;
}

export function extractFromZodV4(schema: unknown): SchemaIngestionResult {
	const fields: SchemaFieldInfo[] = [];

	const v4 = schema as ZodV4Internal;
	if (!v4._zod?.def) {
		return { fields: [], metadata: { vendor: "zod4", validationOnly: true } };
	}

	const metadata: SchemaMetadata = { vendor: "zod4" };
	walkZodV4(schema, "", fields, true, { active: new WeakSet() });
	return { fields, metadata };
}

function walkZodV4(
	schema: unknown,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): void {
	const v4 = schema as ZodV4Internal;
	const def = v4._zod?.def;
	if (!def || !isObject(schema) || ctx.active.has(schema)) return;
	ctx.active.add(schema);

	try {
		const type = def.type as string | undefined;
		if (!type) return;
		if (walkZodV4Wrapper(schema, def, type, prefix, fields, required, ctx)) return;
		if (walkZodV4Structure(schema, def, type, prefix, fields, required, ctx)) return;
		if (walkZodV4SpecialLeaf(schema, def, type, prefix, fields, required, ctx)) return;
		if (!prefix) return;
		pushZodV4Field(fields, prefix, mapZodV4Type(type), required, buildV4Metadata(schema, def, ctx), ctx.defaultValue);
	} finally {
		ctx.active.delete(schema);
	}
}

function walkZodV4Wrapper(
	schema: unknown,
	def: Readonly<Record<string, unknown>>,
	type: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	if (type === "optional") {
		const nextCtx = withWrapperMetadata(schema, def, ctx);
		walkZodV4Inner(def, "innerType", prefix, fields, false, nextCtx);
		return true;
	}
	if (type === "nullable") {
		const nextCtx = withWrapperMetadata(schema, def, ctx);
		walkZodV4Inner(def, "innerType", prefix, fields, required, { ...nextCtx, nullable: true });
		return true;
	}
	if (type === "default") {
		const nextCtx = withWrapperMetadata(schema, def, ctx);
		const defaultValue = typeof def.defaultValue === "function" ? (def.defaultValue as () => unknown)() : undefined;
		walkZodV4Inner(def, "innerType", prefix, fields, false, { ...nextCtx, defaultValue });
		return true;
	}
	if (type === "effects" || type === "pipeline" || type === "pipe") {
		// Fields describe accepted input, so input metadata overrides output metadata; wrappers remain highest.
		const outputMetadata = collectV4Metadata(def.out, new WeakSet());
		const lowerMetadata = mergeZodMetadata(ctx.lowerMetadata, outputMetadata);
		const nextCtx = withWrapperMetadata(schema, def, withLowerMetadata(ctx, lowerMetadata));
		walkZodV4Inner(def, type === "effects" ? "schema" : "in", prefix, fields, required, nextCtx);
		return true;
	}
	if (type === "lazy") {
		const nextCtx = withWrapperMetadata(schema, def, ctx);
		const getter = def.getter as (() => unknown) | undefined;
		if (getter) walkZodV4(getter(), prefix, fields, required, nextCtx);
		return true;
	}
	if (type !== "branded" && type !== "readonly" && type !== "catch") return false;
	const nextCtx = withWrapperMetadata(schema, def, ctx);
	const key = type === "branded" ? "type" : "innerType";
	const innerCtx = type === "readonly" ? { ...nextCtx, readOnly: true } : nextCtx;
	walkZodV4Inner(def, key, prefix, fields, required, innerCtx);
	return true;
}

function walkZodV4Structure(
	schema: unknown,
	def: Readonly<Record<string, unknown>>,
	type: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	if (type === "object") {
		const shape = def.shape as Record<string, unknown> | undefined;
		for (const [key, value] of Object.entries(shape ?? {})) {
			walkZodV4(value, prefix ? `${prefix}.${key}` : key, fields, true, { active: ctx.active });
		}
		return true;
	}
	if (type === "array") {
		pushZodV4Field(fields, prefix, "array", required, buildV4Metadata(schema, def, ctx), ctx.defaultValue);
		return true;
	}
	if (type !== "intersection") return false;
	const left = def.left as unknown;
	const right = def.right as unknown;
	if (left) walkZodV4(left, prefix, fields, required, ctx);
	if (right) walkZodV4(right, prefix, fields, required, ctx);
	return true;
}

function walkZodV4SpecialLeaf(
	schema: unknown,
	def: Readonly<Record<string, unknown>>,
	type: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	let fieldType: SchemaFieldType;
	let extra: Record<string, unknown>;
	if (type === "record") {
		fieldType = "object";
		extra = { additionalProperties: true };
	} else if (type === "tuple") {
		fieldType = "array";
		extra = { tuple: true, itemCount: (def.items as readonly unknown[] | undefined)?.length ?? 0 };
	} else if (type === "literal") {
		const value = def.value;
		fieldType = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
		extra = { const: value };
	} else if (type === "nativeEnum") {
		fieldType = "enum";
		extra = { enum: zodV4EnumValues(def.entries ?? def.values) ?? [] };
	} else return false;
	pushZodV4Field(fields, prefix, fieldType, required, buildV4Metadata(schema, def, ctx, extra));
	return true;
}

function pushZodV4Field(
	fields: SchemaFieldInfo[],
	path: string,
	type: SchemaFieldType,
	required: boolean,
	metadata?: SchemaFieldMetadata,
	defaultValue?: unknown,
): void {
	if (!path) return;
	fields.push({
		path,
		type,
		required,
		...(defaultValue !== undefined ? { defaultValue } : {}),
		...(metadata ? { metadata } : {}),
	});
}

function walkZodV4Inner(
	def: Readonly<Record<string, unknown>>,
	key: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): void {
	const inner = def[key];
	if (inner && typeof inner === "object") {
		walkZodV4(inner, prefix, fields, required, ctx);
	}
}

function mapZodV4Type(type: string): SchemaFieldType {
	switch (type) {
		case "string":
			return "string";
		case "number":
		case "float32":
		case "float64":
			return "number";
		case "int":
		case "bigint":
			return "integer";
		case "boolean":
			return "boolean";
		case "date":
			return "date";
		case "enum":
			return "enum";
		case "union":
		case "discriminatedUnion":
			return "union";
		case "array":
			return "array";
		case "object":
			return "object";
		default:
			return "unknown";
	}
}

/** Extract validation checks from v4 def.checks */
function extractV4Checks(def: Readonly<Record<string, unknown>>): Record<string, unknown> {
	const checks = def.checks as readonly Record<string, unknown>[] | undefined;
	if (!checks || checks.length === 0) return {};
	const result: Record<string, unknown> = {};
	for (const check of checks) {
		const kind = check.kind as string | undefined;
		if (kind) applyV4Check(result, check, kind);
	}
	return result;
}

function applyV4Check(result: Record<string, unknown>, check: Record<string, unknown>, kind: string): void {
	switch (kind) {
		case "min":
			result.minLength = check.value;
			break;
		case "max":
			result.maxLength = check.value;
			break;
		case "length":
			result.minLength = check.value;
			result.maxLength = check.value;
			break;
		case "regex":
			result.pattern = String(check.regex);
			break;
		case "email":
		case "url":
		case "uuid":
		case "cuid":
			result.format = kind;
			break;
		case "gte":
		case "min_value":
			result.minimum = check.value;
			break;
		case "lte":
		case "max_value":
			result.maximum = check.value;
			break;
		case "gt":
			result.exclusiveMinimum = check.value;
			break;
		case "lt":
			result.exclusiveMaximum = check.value;
			break;
		case "int":
			result.format = "int";
			break;
		default:
			result[kind] = check.value ?? true;
	}
}

/** Build metadata from v4 def, context, and extras */
function buildV4Metadata(
	schema: unknown,
	def: Readonly<Record<string, unknown>>,
	ctx: WalkContext,
	extra?: Record<string, unknown>,
): SchemaFieldMetadata | undefined {
	const result: Record<string, unknown> = {};

	// Description
	const desc = def.description as string | undefined;
	if (desc) result.description = desc;

	// Checks
	Object.assign(result, extractV4Checks(def));

	// Enum values
	if (def.type === "enum") {
		result.enum = zodV4EnumValues(def.entries) ?? [];
	}

	// Context
	if (ctx.nullable) result.nullable = true;
	if (ctx.readOnly) result.readOnly = true;

	// Extra
	if (extra) Object.assign(result, extra);

	const inferred = Object.keys(result).length ? (result as SchemaFieldMetadata) : undefined;
	const local = mergeZodMetadata(readZodMetadata(schema, def), inferred);
	const withLower = mergeZodMetadata(ctx.lowerMetadata, local);
	return mergeZodMetadata(withLower, ctx.metadata);
}

function withWrapperMetadata(schema: unknown, def: ZodDef, ctx: WalkContext): WalkContext {
	const metadata = readZodMetadata(schema, def);
	const merged = mergeZodMetadata(metadata, ctx.metadata);
	return merged ? { ...ctx, metadata: merged } : ctx;
}

function withLowerMetadata(ctx: WalkContext, metadata?: SchemaFieldMetadata): WalkContext {
	return metadata ? { ...ctx, lowerMetadata: metadata } : ctx;
}

function isObject(value: unknown): value is object {
	return value !== null && typeof value === "object";
}

function collectV4Metadata(schema: unknown, active: WeakSet<object>): SchemaFieldMetadata | undefined {
	if (!isObject(schema) || active.has(schema)) return undefined;
	active.add(schema);
	try {
		const def = (schema as ZodV4Internal)._zod?.def;
		if (!def) return undefined;

		const type = def.type as string | undefined;
		if (type === "pipe" || type === "pipeline") {
			const output = collectV4Metadata(def.out, active);
			const input = collectV4Metadata(def.in, active);
			return mergeZodMetadata(mergeZodMetadata(output, input), readZodMetadata(schema, def));
		}
		const key = type ? metadataInnerKey(type) : undefined;
		const inner = key ? collectV4Metadata(def[key], active) : undefined;
		return mergeZodMetadata(inner, readZodMetadata(schema, def));
	} finally {
		active.delete(schema);
	}
}

function metadataInnerKey(type: string): string | undefined {
	if (["optional", "nullable", "default", "catch", "readonly"].includes(type)) return "innerType";
	if (type === "effects") return "schema";
	if (type === "branded") return "type";
	return undefined;
}
