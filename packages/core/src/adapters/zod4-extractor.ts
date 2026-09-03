import { SchemaError } from "../errors.js";
import type {
	SchemaFieldInfo,
	SchemaFieldMetadata,
	SchemaFieldType,
	SchemaIngestionResult,
	SchemaMetadata,
} from "../types.js";

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
}

export function extractFromZodV4(schema: unknown): SchemaIngestionResult {
	const fields: SchemaFieldInfo[] = [];

	const v4 = schema as ZodV4Internal;
	if (!v4._zod?.def) {
		return { fields: [], metadata: { vendor: "zod4", validationOnly: true } };
	}

	const metadata: SchemaMetadata = { vendor: "zod4" };
	walkZodV4(schema, "", fields, true);
	return { fields, metadata };
}

function walkZodV4(
	schema: unknown,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext = {},
): void {
	const v4 = schema as ZodV4Internal;
	const def = v4._zod?.def;
	if (!def) return;

	const type = def.type as string | undefined;
	if (!type) return;
	if (walkZodV4Wrapper(def, type, prefix, fields, required, ctx)) return;
	if (walkZodV4Structure(def, type, prefix, fields, required, ctx)) return;
	if (walkZodV4SpecialLeaf(def, type, prefix, fields, required, ctx)) return;
	pushZodV4Field(fields, prefix, mapZodV4Type(type), required, buildV4Metadata(def, ctx), ctx.defaultValue);
}

function walkZodV4Wrapper(
	def: Readonly<Record<string, unknown>>,
	type: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	if (type === "optional") {
		walkZodV4Inner(def, "innerType", prefix, fields, false, ctx);
		return true;
	}
	if (type === "nullable") {
		walkZodV4Inner(def, "innerType", prefix, fields, required, { ...ctx, nullable: true });
		return true;
	}
	if (type === "default") {
		const defaultValue = typeof def.defaultValue === "function" ? (def.defaultValue as () => unknown)() : undefined;
		walkZodV4Inner(def, "innerType", prefix, fields, false, { ...ctx, defaultValue });
		return true;
	}
	if (type === "effects" || type === "pipeline") {
		walkZodV4Inner(def, type === "effects" ? "schema" : "in", prefix, fields, required, ctx);
		return true;
	}
	if (type === "lazy") {
		const getter = def.getter as (() => unknown) | undefined;
		if (getter) walkZodV4(getter(), prefix, fields, required, ctx);
		return true;
	}
	if (type !== "branded" && type !== "readonly" && type !== "catch") return false;
	const key = type === "branded" ? "type" : "innerType";
	const nextCtx = type === "readonly" ? { ...ctx, readOnly: true } : ctx;
	walkZodV4Inner(def, key, prefix, fields, required, nextCtx);
	return true;
}

function walkZodV4Structure(
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
			walkZodV4(value, prefix ? `${prefix}.${key}` : key, fields, true);
		}
		return true;
	}
	if (type === "array") {
		pushZodV4Field(fields, prefix, "array", required, buildV4Metadata(def, ctx));
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
		const values = def.values as Record<string, unknown> | undefined;
		fieldType = "enum";
		extra = { enum: values ? Object.values(values) : [] };
	} else return false;
	pushZodV4Field(fields, prefix, fieldType, required, buildV4Metadata(def, ctx, extra));
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
	ctx: WalkContext = {},
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
		if (!kind) continue;
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
	return result;
}

/** Build metadata from v4 def, context, and extras */
function buildV4Metadata(
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
	if (def.values && def.type === "enum") {
		result.enum = def.values;
	}

	// Context
	if (ctx.nullable) result.nullable = true;
	if (ctx.readOnly) result.readOnly = true;

	// Extra
	if (extra) Object.assign(result, extra);

	// Formbar metadata
	const rawMeta = def.metadata as Record<string, unknown> | undefined;
	if (rawMeta && "x-formbar" in rawMeta) {
		throw new SchemaError(
			"SCHEMA_ZOD_TRANSFORM_FORBIDDEN",
			"x-formbar is not allowed in Zod metadata. Use .meta({ formbar: { ... } }) instead.",
		);
	}
	if (rawMeta && typeof rawMeta === "object" && "formbar" in rawMeta) {
		const formbar = rawMeta.formbar as Record<string, unknown>;
		Object.assign(result, formbar);
	}

	return Object.keys(result).length > 0 ? (result as SchemaFieldMetadata) : undefined;
}
