import type { DocumentContext } from "../providers/types.js";
import type { DocumentBuilder } from "./builder.js";

// Expose capabilities, not the builder's mutable state or finalization method.
export function createContext(builder: DocumentBuilder): DocumentContext {
	return Object.freeze({
		limits: builder.limits,
		visit: builder.visit.bind(builder),
		node: builder.node.bind(builder),
		copy: builder.copy.bind(builder),
		diagnose: builder.diagnose.bind(builder),
		capability: builder.capability.bind(builder),
		definition: builder.definition.bind(builder),
		metadata: builder.metadata.bind(builder),
		available: builder.available.bind(builder),
	});
}
