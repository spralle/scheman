import type { SchemaNode } from "../../document/nodes.js";
import { data, pointer } from "../../document/reader.js";
import type { Side } from "../../document/types.js";
import type { DocumentContext, SchemaDocumentProvider } from "../types.js";
import { checks } from "./checks.js";
import { executionCache, executionPolicy } from "./execution.js";
import { metadata } from "./metadata.js";
import { scalar } from "./scalar.js";
import { structure } from "./structure.js";
import type { Walk, ZodProviderOptions, ZodReader } from "./types.js";
import { wrappers } from "./wrappers.js";

export function createZodProvider(reader: ZodReader, options: ZodProviderOptions): SchemaDocumentProvider {
	const policy = executionPolicy(options);
	return {
		name: `zod${reader.version}`,
		build: (source, context) => {
			const walk = walker(reader, context, executionCache(policy));
			return { input: walk(source, "input", ""), output: walk(source, "output", "") };
		},
	};
}
function walker(reader: ZodReader, context: DocumentContext, resolve: ReturnType<typeof executionCache>) {
	let work = 0;
	const walk = (source: unknown, side: Side, path: string) =>
		context.visit(source, side, path, () => {
			const partial = (code: string) => {
				context.diagnose(code, side, path);
				context.capability(side, "partial");
			};
			const state: Walk = {
				reader,
				context,
				side,
				path,
				partial,
				take: () => {
					if (context.available() && work++ < context.limits.maxEdges) return true;
					partial("zod.traversal-limit");
					return false;
				},
				child: (child, key) => walk(child, side, pointer(path, key)),
				resolve: (target, category, callback) => resolve(target, category, callback, partial),
				unknown: (reason) => {
					partial(reason);
					return context.node(side, path, () => ({ kind: "unknown", reason }));
				},
			};
			return build(source, state);
		});
	return walk;
}
function build(source: unknown, state: Walk): SchemaNode {
	const definition = state.reader.definition(source);
	const kind = state.reader.kind(definition);
	const node =
		wrappers(source, definition, kind, state) ??
		structure(source, definition, kind, state) ??
		scalar(source, definition, kind, state);
	if (!node) {
		state.partial("zod.unsupported-type");
		return { kind: "opaque", reason: kind };
	}
	if (!state.context.available()) {
		state.partial("zod.traversal-limit");
		return node;
	}
	const annotated = { ...node, metadata: metadata(source, definition, state), constraints: checks(definition, state) };
	if (data(definition, "coerce") !== true) return annotated;
	state.partial("zod.coercion");
	return {
		kind: "wrapper",
		wrapper: "coerce",
		inner:
			state.side === "input"
				? state.unknown("zod.coercion-input")
				: state.context.node(state.side, state.path, () => annotated),
		metadata: annotated.metadata,
	};
}
