import type { SchemaNode } from "../../document/nodes.js";
import { data, isReference } from "../../document/reader.js";
import type { NodeBuilder, Walk } from "./types.js";

type Wrapper = Extract<SchemaNode, { kind: "wrapper" }>["wrapper"];
export const wrappers: NodeBuilder = (_source, definition, kind, state) => {
	if (["optional", "nullable", "readonly", "branded", "default", "catch", "prefault"].includes(kind))
		return simple(definition, kind, state);
	if (kind === "pipeline" || kind === "pipe") return pipeline(definition, state);
	if (kind === "effects") return effect(definition, state);
	if (kind === "transform")
		return {
			kind: "wrapper",
			wrapper: "effect",
			inner: state.unknown("zod.transform-unknown"),
			value: { effect: "transform" },
		};
	return undefined;
};
function simple(definition: unknown, kind: string, state: Walk): SchemaNode {
	const inner = state.child(data(definition, kind === "branded" ? "type" : "innerType"), "inner");
	const wrapper = (kind === "branded" ? "brand" : kind === "prefault" ? "default" : kind) as Wrapper;
	if (!["default", "catch", "prefault"].includes(kind)) return { kind: "wrapper", wrapper, inner };
	state.partial(`zod.${kind}.deferred`);
	const key = kind === "catch" ? "catchValue" : "defaultValue";
	const descriptor = isReference(definition) ? Object.getOwnPropertyDescriptor(definition, key) : undefined;
	const passive = descriptor && "value" in descriptor && typeof descriptor.value !== "function";
	return {
		kind: "wrapper",
		wrapper,
		inner,
		value: passive ? state.context.copy(descriptor.value, state.side, state.path) : { status: "deferred", kind },
	};
}
function pipeline(definition: unknown, state: Walk): SchemaNode {
	const selected = data(definition, state.side === "input" ? "in" : "out");
	return {
		kind: "wrapper",
		wrapper: "pipeline",
		inner: state.child(selected, state.side),
		value: { selectedSide: state.side },
	};
}
function effect(definition: unknown, state: Walk): SchemaNode {
	const kind = data(data(definition, "effect"), "type");
	state.partial("zod.effect.opaque");
	const unknown =
		(kind === "transform" && state.side === "output") || (kind === "preprocess" && state.side === "input");
	return {
		kind: "wrapper",
		wrapper: "effect",
		inner: unknown ? state.unknown("zod.effect-unknown-side") : state.child(data(definition, "schema"), "inner"),
		value: { effect: typeof kind === "string" ? kind : "unknown" },
	};
}
