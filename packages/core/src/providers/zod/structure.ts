import type { PropertyEdge, SchemaNode } from "../../document/nodes.js";
import { data, entries, isReference } from "../../document/reader.js";
import type { NodeRef } from "../../document/types.js";
import { evidence, observed } from "./evidence.js";
import { presence } from "./presence.js";
import type { NodeBuilder, Walk } from "./types.js";

export const structure: NodeBuilder = (source, definition, kind, state) => {
	if (kind === "object") return object(source, definition, state);
	if (kind === "array") return { kind: "array", items: state.child(state.reader.arrayElement(definition), "items") };
	if (kind === "tuple") return tuple(definition, state);
	if (kind === "record") return record(definition, state);
	if (kind === "union" || kind === "discriminatedunion") return union(definition, state);
	if (kind === "intersection")
		return {
			kind,
			operands: [state.child(data(definition, "left"), "left"), state.child(data(definition, "right"), "right")],
		};
	if (kind === "lazy") return lazy(source, definition, state);
	return undefined;
};
function object(source: unknown, definition: unknown, state: Walk): SchemaNode {
	const shape = state.reader.shape(source, definition, state);
	if (!isReference(shape)) {
		state.partial("zod.shape-unavailable");
		return { kind: "unknown", reason: "zod.shape-unavailable" };
	}
	const properties: PropertyEdge[] = [];
	for (const [name, child] of entries(shape)) {
		if (!state.take()) break;
		const localPresence = presence(child, state);
		if (localPresence === "unknown") state.partial("zod.presence-unknown");
		properties.push({ name, presence: localPresence, node: state.child(child, name) });
	}
	return {
		kind: "object",
		properties,
		required: properties.filter((edge) => edge.presence === "required").map((edge) => edge.name),
		...unknownKeys(definition, state),
	};
}
function unknownKeys(
	definition: unknown,
	state: Walk,
): Pick<Extract<SchemaNode, { kind: "object" }>, "unknownKeys" | "additionalProperties"> {
	if (!state.context.available()) return { unknownKeys: "unknown" };
	const item = evidence(definition, "catchall");
	if (item.status === "unavailable") {
		state.partial("zod.catchall-unreadable");
		return { unknownKeys: "unknown" };
	}
	const catchall = item.status === "value" ? item.value : undefined;
	const kind = state.reader.kind(state.reader.definition(catchall));
	if (catchall && kind !== "never") {
		return {
			unknownKeys: state.reader.version === 4 && kind === "unknown" ? "passthrough" : "schema",
			additionalProperties: state.child(catchall, "catchall"),
		};
	}
	if (state.reader.version === 4) return { unknownKeys: kind === "never" ? "reject" : "strip" };
	const policy = observed(definition, "unknownKeys", state, "zod.unknown-keys-unreadable");
	return {
		unknownKeys:
			policy === "strict"
				? "reject"
				: policy === "passthrough"
					? "passthrough"
					: policy === "strip"
						? "strip"
						: "unknown",
	};
}
function children(raw: unknown, state: Walk): NodeRef[] {
	if (!Array.isArray(raw)) {
		state.partial("zod.children-unreadable");
		return [];
	}
	const result: NodeRef[] = [];
	for (let index = 0; index < raw.length && state.take(); index++) result.push(state.child(data(raw, index), index));
	return result;
}
function tuple(definition: unknown, state: Walk): SchemaNode {
	const item = evidence(definition, "rest");
	const rest = item.status === "value" ? item.value : undefined;
	const items = children(data(definition, "items"), state);
	const restNode =
		item.status === "unavailable" ? state.unknown("zod.rest-unreadable") : rest ? state.child(rest, "rest") : undefined;
	return {
		kind: "tuple",
		items,
		...(restNode ? { rest: restNode } : {}),
	};
}
function record(definition: unknown, state: Walk): SchemaNode {
	const key = data(definition, "keyType");
	const exhaustive = state.reader.recordExhaustive(key);
	if (exhaustive === "unknown") state.partial("zod.record-exhaustiveness-unknown");
	return {
		kind: "record",
		key: state.child(key, "key"),
		value: state.child(data(definition, "valueType"), "value"),
		exhaustive,
	};
}
function union(definition: unknown, state: Walk): SchemaNode {
	const discriminator = observed(definition, "discriminator", state, "zod.discriminator-unreadable");
	return {
		kind: "union",
		semantics: "zod",
		alternatives: children(data(definition, "options"), state),
		...(discriminator === undefined
			? {}
			: { discriminator: state.context.copy(discriminator, state.side, state.path) }),
	};
}
function lazy(source: unknown, definition: unknown, state: Walk): SchemaNode {
	const getter = data(definition, "getter");
	const target =
		typeof getter === "function" ? state.resolve(source, "lazy", () => getter.call(definition)) : undefined;
	if (!target) {
		state.partial("zod.lazy-unresolved");
		return { kind: "ref", reference: "lazy", unresolved: "zod.lazy-unresolved" };
	}
	return { kind: "ref", reference: "lazy", target: state.child(target, "lazy") };
}
