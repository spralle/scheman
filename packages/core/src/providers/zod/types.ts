import type { SchemaNode } from "../../document/nodes.js";
import type { NodeRef, Side } from "../../document/types.js";
import type { DocumentContext } from "../types.js";

export interface ZodProviderOptions {
	/** Trusted vendor calls may execute user code indirectly; this is not a sandbox or a timeout boundary. */
	readonly execution?: {
		readonly shape?: "allow" | "deny";
		readonly lazy?: "allow" | "deny";
		readonly metadata?: "allow" | "deny";
	};
}
export interface ZodReader {
	readonly version: 3 | 4;
	definition(source: unknown): unknown;
	kind(definition: unknown): string;
	arrayElement(definition: unknown): unknown;
	recordExhaustive(key: unknown): boolean | "unknown";
	shape(source: unknown, definition: unknown, state: Walk): unknown;
}
export interface Walk {
	readonly context: DocumentContext;
	readonly reader: ZodReader;
	readonly side: Side;
	readonly path: string;
	child(source: unknown, key: string | number): NodeRef;
	resolve(source: unknown, category: "shape" | "lazy" | "metadata", callback: () => unknown): unknown;
	partial(code: string): void;
	unknown(reason: string): NodeRef;
	take(): boolean;
}
export type NodeBuilder = (source: unknown, definition: unknown, kind: string, state: Walk) => SchemaNode | undefined;
