import { SchemaError } from "../errors.js";
import type { SchemaNode } from "./nodes.js";
import { data, entries, isReference } from "./reader.js";
import type { NodeRef, OwnedValue } from "./types.js";

export interface SnapshotContext {
	edge(ref: NodeRef): NodeRef;
	copy(value: unknown): OwnedValue;
	take(bytes: number): void;
}
type Rule = (value: unknown, context: SnapshotContext) => unknown;
type Fields = Record<string, Rule>;

function text(value: unknown, context: SnapshotContext): string {
	if (typeof value !== "string") invalidNode();
	context.take(value.length * 2);
	return value;
}

function oneOf(...allowed: readonly unknown[]): Rule {
	return (value) => {
		if (!allowed.includes(value)) invalidNode();
		return value;
	};
}

function optional(rule: Rule): Rule {
	return (value, context) => (value === undefined ? undefined : rule(value, context));
}

const edge: Rule = (value, context) => context.edge(value as NodeRef);
const owned: Rule = (value, context) => context.copy(value);

function list(rule: Rule): Rule {
	return (value, context) => {
		if (!Array.isArray(value)) invalidNode();
		const result: unknown[] = [];
		const length = data(value, "length") as number;
		for (let index = 0; index < length; index++) {
			context.take(0);
			result.push(rule(data(value, index), context));
		}
		return Object.freeze(result);
	};
}

function fields(specification: Fields): Rule {
	return (value, context) => {
		if (!isReference(value) || Array.isArray(value)) invalidNode();
		const result: Record<string, unknown> = Object.create(null);
		for (const [key, rule] of Object.entries(specification)) {
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			if (descriptor && !("value" in descriptor)) invalidNode();
			const item = rule(data(value, key), context);
			if (item !== undefined) result[key] = item;
		}
		return Object.freeze(result);
	};
}

function record(rule: Rule): Rule {
	return (value, context) => {
		if (!isReference(value) || Array.isArray(value)) invalidNode();
		const result: Record<string, unknown> = Object.create(null);
		for (const [key, item] of entries(value)) {
			context.take(key.length * 2);
			result[key] = rule(item, context);
		}
		return Object.freeze(result);
	};
}

const applicators = fields({
	if: optional(edge),
	// biome-ignore lint/suspicious/noThenProperty: Internal JSON keyword parser table; never passed across an async boundary.
	then: optional(edge),
	else: optional(edge),
	not: optional(edge),
	contains: optional(edge),
	propertyNames: optional(edge),
	patternProperties: optional(record(edge)),
	dependentSchemas: optional(record(edge)),
});
const common: Fields = { metadata: optional(owned), constraints: optional(owned), applicators: optional(applicators) };
const primitives = [
	"string",
	"number",
	"integer",
	"boolean",
	"null",
	"undefined",
	"void",
	"bigint",
	"symbol",
	"date",
	"NaN",
];
const property = fields({ name: text, presence: oneOf("required", "optional", "unknown"), node: edge });
const specifications: Record<string, Fields> = {
	unknown: { reason: text },
	opaque: { reason: text },
	unconstrained: { domain: oneOf("json", "js") },
	never: {},
	primitive: { type: oneOf(...primitives) },
	literal: { value: owned },
	enum: { values: list(owned) },
	object: {
		properties: list(property),
		required: list(text),
		additionalProperties: optional(edge),
		unknownKeys: oneOf("strip", "reject", "passthrough", "schema", "unknown"),
	},
	array: { items: edge },
	tuple: { items: list(edge), rest: optional(edge) },
	record: { key: edge, value: edge, exhaustive: oneOf(true, false, "unknown") },
	union: { alternatives: list(edge), semantics: oneOf("anyOf", "oneOf", "zod"), discriminator: optional(owned) },
	intersection: { operands: list(edge) },
	ref: { reference: text, target: optional(edge), unresolved: optional(text) },
	wrapper: {
		wrapper: oneOf("optional", "nullable", "default", "catch", "readonly", "brand", "pipeline", "effect", "coerce"),
		inner: edge,
		value: optional(owned),
	},
};

export function snapshot(node: SchemaNode, context: SnapshotContext): SchemaNode {
	const kind = data(node, "kind");
	if (typeof kind !== "string" || !Object.hasOwn(specifications, kind)) invalidNode();
	return fields({ kind: oneOf(kind), ...common, ...specifications[kind] })(node, context) as SchemaNode;
}

export function invalidNode(): never {
	throw new SchemaError(
		"SCHEMA_INVALID_PROVIDER",
		"Provider must return valid nodes and references created by its context",
	);
}

export class StructureLimit extends Error {}
