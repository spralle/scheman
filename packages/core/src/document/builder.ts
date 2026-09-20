import type { DocumentContext } from "../providers/types.js";
import { Diagnostics } from "./diagnostics.js";
import type { DocumentLimits } from "./limits.js";
import type { SchemaNode } from "./nodes.js";
import { Ownership } from "./ownership.js";
import { data, isReference } from "./reader.js";
import { StructureLimit, invalidNode, snapshot } from "./snapshot.js";
import type { Availability, Definition, NodeRef, OwnedValue, SchemaDocument, Side } from "./types.js";

export class DocumentBuilder implements DocumentContext {
	readonly limits: DocumentLimits;
	private readonly nodes: Record<string, SchemaNode> = Object.create(null);
	private readonly definitions: Definition[] = [];
	private readonly references = new WeakSet<object>();
	private readonly pending = new Set<string>();
	private readonly cache = { input: new WeakMap<object, NodeRef>(), output: new WeakMap<object, NodeRef>() };
	private readonly diagnostics: Diagnostics;
	private readonly ownership: Ownership;
	private readonly sentinel: NodeRef;
	private documentMetadata: OwnedValue = Object.freeze({});
	private count = 0;
	// The two mandatory root edges are reserved before provider traversal.
	private edges = 2;
	private depth = 0;
	private structuralEntries = 0;
	private structuralBytes = 0;
	private location: { side: Side; sourcePointer: string } = { side: "input", sourcePointer: "" };
	private closed = false;

	constructor(limits: DocumentLimits) {
		this.limits = Object.freeze({ ...limits });
		this.diagnostics = new Diagnostics(limits.maxDiagnostics);
		this.ownership = new Ownership(limits, (code) =>
			this.diagnose(code, this.location.side, this.location.sourcePointer),
		);
		this.sentinel = this.reserve();
		this.nodes[this.sentinel.nodeId] = Object.freeze({ kind: "unknown", reason: "resource-limit" });
		this.pending.delete(this.sentinel.nodeId);
	}

	visit(source: unknown, side: Side, sourcePointer: string, build: () => SchemaNode): NodeRef {
		this.assertOpen();
		this.checkLocation(side, sourcePointer);
		const existing = isReference(source) ? this.cache[side].get(source) : undefined;
		if (existing) return existing;
		if (!this.available()) return this.limited(side, sourcePointer);
		const ref = this.reserve();
		if (isReference(source)) this.cache[side].set(source, ref);
		this.populate(ref, side, sourcePointer, build);
		return ref;
	}

	node(side: Side, sourcePointer: string, build: () => SchemaNode): NodeRef {
		return this.visit(undefined, side, sourcePointer, build);
	}

	copy(value: unknown, side: Side, sourcePointer: string): OwnedValue {
		this.assertOpen();
		this.checkLocation(side, sourcePointer);
		const previous = this.location;
		this.location = { side, sourcePointer };
		try {
			return this.ownership.copy(value);
		} finally {
			this.location = previous;
		}
	}

	diagnose(code: string, side: Side, sourcePointer: string): void {
		this.assertOpen();
		this.checkLocation(side, sourcePointer);
		if (typeof code !== "string") invalidNode();
		this.diagnostics.add(code.slice(0, 128), side, sourcePointer.slice(0, 2048));
	}

	capability(side: Side, availability: Availability): void {
		this.assertOpen();
		this.checkLocation(side, "");
		if (!["complete", "partial", "unavailable"].includes(availability)) invalidNode();
		this.diagnostics.capability(side, availability);
	}

	definition(side: Side, sourcePointer: string, node: NodeRef, name?: string): void {
		this.assertOpen();
		this.checkLocation(side, sourcePointer);
		if (name !== undefined && typeof name !== "string") invalidNode();
		if (this.definitions.length >= this.limits.maxDefinitions || this.edges >= this.limits.maxEdges) {
			this.diagnose("DEFINITION_LIMIT", side, sourcePointer);
			return;
		}
		const entry = { side, sourcePointer: sourcePointer.slice(0, 2048), node: this.edge(node, side, sourcePointer) };
		this.definitions.push(Object.freeze(name === undefined ? entry : { ...entry, name: name.slice(0, 2048) }));
	}

	metadata(value: unknown): void {
		this.documentMetadata = this.copy(value, "input", "");
	}

	available(): boolean {
		this.assertOpen();
		return this.count < this.limits.maxNodes && this.depth < this.limits.maxDepth && this.edges < this.limits.maxEdges;
	}

	finish(roots: Readonly<Record<Side, NodeRef>>): SchemaDocument {
		this.assertOpen();
		if (this.pending.size) invalidNode();
		const input = this.reference(data(roots, "input"));
		const output = this.reference(data(roots, "output"));
		this.rootCapability("input", input);
		this.rootCapability("output", output);
		this.closed = true;
		return Object.freeze({
			formatVersion: 1,
			root: Object.freeze({ input, output }),
			nodes: Object.freeze(this.nodes),
			definitions: Object.freeze(this.definitions),
			metadata: this.documentMetadata,
			capabilities: Object.freeze(this.diagnostics.capabilities),
			diagnostics: Object.freeze(this.diagnostics.items),
		});
	}

	private populate(ref: NodeRef, side: Side, sourcePointer: string, build: () => SchemaNode): void {
		const previous = this.location;
		this.location = { side, sourcePointer };
		this.depth++;
		try {
			this.nodes[ref.nodeId] = snapshot(build(), {
				edge: (edge) => this.edge(edge, side, sourcePointer),
				copy: (value) => this.copy(value, side, sourcePointer),
				take: (bytes) => this.takeStructure(bytes),
			});
			const kind = this.nodes[ref.nodeId].kind;
			if (kind === "unknown" || kind === "opaque") this.diagnose("STRUCTURE_UNAVAILABLE", side, sourcePointer);
			this.pending.delete(ref.nodeId);
		} catch (error) {
			if (!(error instanceof StructureLimit)) throw error;
			this.diagnose("GRAPH_LIMIT", side, sourcePointer);
			this.nodes[ref.nodeId] = Object.freeze({ kind: "unknown", reason: "resource-limit" });
			this.pending.delete(ref.nodeId);
		} finally {
			this.depth--;
			this.location = previous;
		}
	}

	private reserve(): NodeRef {
		const ref = Object.freeze({ nodeId: `n${this.count++}` });
		this.references.add(ref);
		this.pending.add(ref.nodeId);
		return ref;
	}

	private edge(ref: NodeRef, side: Side, sourcePointer: string): NodeRef {
		this.reference(ref);
		if (this.edges >= this.limits.maxEdges) {
			this.diagnose("GRAPH_LIMIT", side, sourcePointer);
			throw new StructureLimit();
		}
		this.edges++;
		return ref;
	}

	private reference(value: unknown): NodeRef {
		if (!isReference(value) || !this.references.has(value)) invalidNode();
		return value as NodeRef;
	}

	private limited(side: Side, sourcePointer: string): NodeRef {
		this.diagnose("GRAPH_LIMIT", side, sourcePointer);
		return this.sentinel;
	}

	private assertOpen(): void {
		if (this.closed) invalidNode();
	}

	private checkLocation(side: Side, sourcePointer: string): void {
		if ((side !== "input" && side !== "output") || typeof sourcePointer !== "string") invalidNode();
	}

	private rootCapability(side: Side, ref: NodeRef): void {
		const kind = this.nodes[ref.nodeId].kind;
		if (kind === "unknown" || kind === "opaque") this.capability(side, "unavailable");
	}

	private takeStructure(bytes: number): void {
		this.structuralEntries++;
		this.structuralBytes += bytes;
		if (this.structuralEntries > this.limits.maxEdges || this.structuralBytes > this.limits.maxMetadataBytes)
			throw new StructureLimit();
	}
}
