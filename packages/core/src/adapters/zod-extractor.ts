import { SchemaError } from "../errors.js";
import type {
	SchemaFieldInfo,
	SchemaFieldMetadata,
	SchemaFieldType,
	SchemaIngestionResult,
	SchemaMetadata,
} from "../types.js";

// Zod internal types for duck-typed traversal (Zod has no formal traversal API)
interface ZodTypeDef {
	readonly typeName?: string;
	readonly description?: string;
	readonly checks?: readonly unknown[];
}

interface ZodLike {
	readonly _def?: ZodTypeDef & Record<string, unknown>;
	readonly _type?: string;
}

export function extractFromZod(schema: unknown): SchemaIngestionResult {
	const zodSchema = schema as ZodLike;
	if (!zodSchema._def) {
		throw new SchemaError("SCHEMA_PARSE_FAILED", "Schema does not appear to be a Zod schema");
	}

	const fields: SchemaFieldInfo[] = [];

	const rootDef = zodSchema._def;
	const rootExtensions = rootDef ? extractVendorExtensions(rootDef) : undefined;
	const metadata: SchemaMetadata = {
		vendor: "zod",
		...(rootExtensions ? { extra: rootExtensions as unknown as Readonly<Record<string, unknown>> } : {}),
	};

	walkZodSchema(zodSchema, "", fields, true);

	return { fields, metadata };
}

interface WalkContext {
	nullable?: boolean;
	readOnly?: boolean;
	defaultValue?: unknown;
}

function walkZodSchema(
	schema: ZodLike,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext = {},
): void {
	const def = schema._def;
	if (!def) return;

	const typeName = def.typeName ?? "";
	if (walkZodPresenceWrapper(def, typeName, prefix, fields, required, ctx)) return;
	if (walkZodTransparentWrapper(def, typeName, prefix, fields, required, ctx)) return;
	if (walkZodStructure(schema, def, typeName, prefix, fields, required, ctx)) return;
	if (walkZodSpecialLeaf(schema, def, typeName, prefix, fields, required, ctx)) return;

	pushZodField(fields, prefix, mapZodType(typeName), required, mergeZodMetadata(schema, ctx), ctx.defaultValue);
}

function walkZodPresenceWrapper(
	def: ZodTypeDef & Record<string, unknown>,
	typeName: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	const inner = def.innerType as ZodLike | undefined;
	if (typeName === "ZodOptional") {
		if (inner) walkZodSchema(inner, prefix, fields, false);
		return true;
	}
	if (typeName === "ZodNullable") {
		if (inner) walkZodSchema(inner, prefix, fields, required, { ...ctx, nullable: true });
		return true;
	}
	if (typeName !== "ZodDefault") return false;
	const defaultValue = typeof def.defaultValue === "function" ? (def.defaultValue as () => unknown)() : undefined;
	if (inner) walkZodSchema(inner, prefix, fields, false, { defaultValue });
	return true;
}

function walkZodTransparentWrapper(
	def: ZodTypeDef & Record<string, unknown>,
	typeName: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	const innerKeys: Readonly<Record<string, string>> = {
		ZodEffects: "schema",
		ZodPipeline: "in",
		ZodBranded: "type",
		ZodCatch: "innerType",
		ZodReadonly: "innerType",
	};
	if (typeName === "ZodLazy") {
		const getter = def.getter as (() => ZodLike) | undefined;
		if (getter) walkZodSchema(getter(), prefix, fields, required);
		return true;
	}
	const innerKey = innerKeys[typeName];
	if (!innerKey) return false;
	const inner = def[innerKey] as ZodLike | undefined;
	const nextCtx = typeName === "ZodReadonly" ? { ...ctx, readOnly: true } : undefined;
	if (inner) walkZodSchema(inner, prefix, fields, required, nextCtx);
	return true;
}

function walkZodStructure(
	schema: ZodLike,
	def: ZodTypeDef & Record<string, unknown>,
	typeName: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	if (typeName === "ZodObject") {
		const shape = def.shape as Record<string, ZodLike> | (() => Record<string, ZodLike>) | undefined;
		const resolvedShape = typeof shape === "function" ? shape() : shape;
		for (const [key, value] of Object.entries(resolvedShape ?? {})) {
			walkZodSchema(value, prefix ? `${prefix}.${key}` : key, fields, true);
		}
		return true;
	}
	if (typeName === "ZodArray") {
		pushZodField(fields, prefix, "array", required, mergeZodMetadata(schema, ctx), ctx.defaultValue, true);
		return true;
	}
	if (typeName !== "ZodIntersection") return false;
	const left = def.left as ZodLike | undefined;
	const right = def.right as ZodLike | undefined;
	if (left) walkZodSchema(left, prefix, fields, required, ctx);
	if (right) walkZodSchema(right, prefix, fields, required, ctx);
	return true;
}

function walkZodSpecialLeaf(
	schema: ZodLike,
	def: ZodTypeDef & Record<string, unknown>,
	typeName: string,
	prefix: string,
	fields: SchemaFieldInfo[],
	required: boolean,
	ctx: WalkContext,
): boolean {
	let type: SchemaFieldType;
	let extra: Record<string, unknown> | undefined;
	if (typeName === "ZodLiteral") {
		const value = def.value;
		type = typeof value === "number" ? "number" : typeof value === "boolean" ? "boolean" : "string";
		extra = { const: value };
	} else if (typeName === "ZodNativeEnum") {
		const values = def.values as Record<string, unknown> | undefined;
		type = "enum";
		extra = { enum: values ? Object.values(values) : [] };
	} else if (typeName === "ZodRecord") {
		type = "object";
		extra = { additionalProperties: true };
	} else if (typeName === "ZodTuple") {
		type = "array";
		extra = { tuple: true, itemCount: (def.items as readonly ZodLike[] | undefined)?.length ?? 0 };
	} else if (typeName === "ZodBigInt") {
		type = "integer";
	} else return false;
	pushZodField(fields, prefix, type, required, mergeZodMetadata(schema, ctx, extra));
	return true;
}

function pushZodField(
	fields: SchemaFieldInfo[],
	path: string,
	type: SchemaFieldType,
	required: boolean,
	metadata?: SchemaFieldMetadata,
	defaultValue?: unknown,
	allowEmptyPath = false,
): void {
	if (!path && !allowEmptyPath) return;
	fields.push({
		path,
		type,
		required,
		...(defaultValue !== undefined ? { defaultValue } : {}),
		...(metadata ? { metadata } : {}),
	});
}

function mapZodType(typeName: string): SchemaFieldType {
	switch (typeName) {
		case "ZodString":
			return "string";
		case "ZodNumber":
			return "number";
		case "ZodBoolean":
			return "boolean";
		case "ZodDate":
			return "date";
		case "ZodEnum":
			return "enum";
		case "ZodUnion":
		case "ZodDiscriminatedUnion":
			return "union";
		case "ZodArray":
			return "array";
		case "ZodObject":
			return "object";
		default:
			return "unknown";
	}
}

/** Extract all object-valued keys from .meta({...}) as vendor extensions */
function extractVendorExtensions(
	def: ZodTypeDef & Record<string, unknown>,
): Record<string, Record<string, unknown>> | undefined {
	const rawMeta = def.metadata as Record<string, unknown> | undefined;
	if (!rawMeta || typeof rawMeta !== "object") return undefined;

	const extensions: Record<string, Record<string, unknown>> = {};

	for (const [key, value] of Object.entries(rawMeta)) {
		if (value !== null && typeof value === "object" && !Array.isArray(value)) {
			extensions[key] = value as Record<string, unknown>;
		}
	}

	return Object.keys(extensions).length > 0 ? extensions : undefined;
}

/** Extract validation checks from Zod _def.checks array */
function extractZodChecks(def: ZodTypeDef & Record<string, unknown>): Record<string, unknown> {
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
			case "int":
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
			default:
				result[kind] = check.value ?? true;
		}
	}
	return result;
}

/** Merge vendor extensions, checks, description, and context into SchemaFieldMetadata */
function mergeZodMetadata(
	schema: ZodLike,
	ctx: WalkContext,
	extra?: Record<string, unknown>,
): SchemaFieldMetadata | undefined {
	const def = schema._def;
	if (!def) return extra ? (extra as SchemaFieldMetadata) : undefined;

	const result: Record<string, unknown> = {};

	// Description from .describe()
	if (def.description) result.description = def.description;

	// Validation checks
	const checks = extractZodChecks(def);
	Object.assign(result, checks);

	// Enum values
	if (def.values && def.typeName === "ZodEnum") {
		result.enum = def.values;
	}

	// Context flags
	if (ctx.nullable) result.nullable = true;
	if (ctx.readOnly) result.readOnly = true;

	// Extra type-specific metadata
	if (extra) Object.assign(result, extra);

	// Vendor extensions (from .meta({ vendor: {...} })) → extensions.*
	const extensions = extractVendorExtensions(def);
	if (extensions) {
		const existing = result.extensions as Record<string, Readonly<Record<string, unknown>>> | undefined;
		result.extensions = { ...existing, ...extensions };
	}

	return Object.keys(result).length > 0 ? (result as SchemaFieldMetadata) : undefined;
}
