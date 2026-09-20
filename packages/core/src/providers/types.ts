import type { DocumentLimits } from "../document/limits.js";
import type { SchemaNode } from "../document/nodes.js";
import type { Availability, NodeRef, OwnedValue, Side } from "../document/types.js";

export interface DocumentContext {
	readonly limits: Readonly<DocumentLimits>;
	visit(source: unknown, side: Side, sourcePointer: string, build: () => SchemaNode): NodeRef;
	node(side: Side, sourcePointer: string, build: () => SchemaNode): NodeRef;
	copy(value: unknown, side: Side, sourcePointer: string): OwnedValue;
	diagnose(code: string, side: Side, sourcePointer: string): void;
	capability(side: Side, availability: Availability): void;
	definition(side: Side, sourcePointer: string, node: NodeRef, name?: string): void;
	metadata(value: unknown): void;
	/** Providers must stop traversing their sources when this returns false. */
	available(): boolean;
}

export interface SchemaDocumentProvider {
	readonly name: string;
	readonly build: (schema: unknown, context: DocumentContext) => Readonly<Record<Side, NodeRef>>;
}
