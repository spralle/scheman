export type Side = "input" | "output";
export type Availability = "complete" | "partial" | "unavailable";
export interface NodeRef {
	readonly nodeId: string;
}
export type OwnedValue =
	| null
	| boolean
	| number
	| string
	| readonly OwnedValue[]
	| { readonly [key: string]: OwnedValue };
export interface Diagnostic {
	readonly code: string;
	readonly severity: "warning" | "error";
	readonly side: Side;
	readonly sourcePointer: string;
	readonly nodeId?: string;
}
export interface Definition {
	readonly side: Side;
	readonly sourcePointer: string;
	readonly name?: string;
	readonly node: NodeRef;
}
export interface SchemaDocument {
	readonly formatVersion: 1;
	readonly root: Readonly<Record<Side, NodeRef>>;
	readonly nodes: Readonly<Record<string, import("./nodes.js").SchemaNode>>;
	readonly definitions: readonly Definition[];
	readonly metadata: OwnedValue;
	readonly capabilities: Readonly<Record<Side, Availability>>;
	readonly diagnostics: readonly Diagnostic[];
}
