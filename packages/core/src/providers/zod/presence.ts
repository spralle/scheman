import type { PropertyEdge } from "../../document/nodes.js";
import { data, isReference } from "../../document/reader.js";
import type { Walk } from "./types.js";

type Presence = PropertyEdge["presence"];
export function presence(source: unknown, state: Walk): Presence {
	return inspect(source, state, new Set());
}
function inspect(source: unknown, state: Walk, seen: Set<unknown>): Presence {
	if (!state.take()) return "unknown";
	if (!isReference(source) || seen.has(source) || seen.size >= state.context.limits.maxDepth) return "unknown";
	const definition = state.reader.definition(source);
	if (definition === undefined || data(definition, "coerce") === true) return "unknown";
	const kind = state.reader.kind(definition);
	const next = new Set(seen).add(source);
	if (["nullable", "readonly", "branded"].includes(kind))
		return inspect(data(definition, kind === "branded" ? "type" : "innerType"), state, next);
	if (kind === "default" && state.side === "output" && state.reader.version === 3)
		return inspect(data(definition, "innerType"), state, next);
	if (kind === "pipe" || kind === "pipeline")
		return inspect(data(definition, state.side === "input" ? "in" : "out"), state, next);
	if (kind === "effects") return effectPresence(definition, state, next);
	if (kind === "union" || kind === "discriminatedunion") return unionPresence(data(definition, "options"), state, next);
	if (kind === "intersection") return intersectionPresence(definition, state, next);
	return directPresence(kind, state);
}
function directPresence(kind: string, state: Walk): Presence {
	if (kind === "optional" || kind === "undefined" || kind === "void") return "optional";
	// V4 defaults bypass inner parsing, so deferred factories cannot prove output presence.
	if (kind === "default" || kind === "prefault") return state.side === "input" ? "optional" : "unknown";
	if (kind === "any" || kind === "unknown") return "optional";
	if (["transform", "lazy", "catch", "custom", "unrecognized"].includes(kind)) return "unknown";
	return "required";
}
function effectPresence(definition: unknown, state: Walk, seen: Set<unknown>): Presence {
	const effect = data(data(definition, "effect"), "type");
	if (effect === "preprocess" && state.side === "input") return "unknown";
	if (effect === "transform" && state.side === "output") return "unknown";
	return inspect(data(definition, "schema"), state, seen);
}
function unionPresence(options: unknown, state: Walk, seen: Set<unknown>): Presence {
	if (!Array.isArray(options)) return "unknown";
	let result: Presence = "required";
	for (let index = 0; index < options.length; index++) {
		if (!state.take()) return "unknown";
		const current = inspect(data(options, index), state, seen);
		if (current === "optional") return "optional";
		if (current === "unknown") result = "unknown";
	}
	return result;
}
function intersectionPresence(definition: unknown, state: Walk, seen: Set<unknown>): Presence {
	const left = inspect(data(definition, "left"), state, seen);
	const right = inspect(data(definition, "right"), state, seen);
	if (left === "required" || right === "required") return "required";
	return left === "optional" && right === "optional" ? "optional" : "unknown";
}
