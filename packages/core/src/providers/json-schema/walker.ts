import type { SchemaNode } from "../../document/nodes.js";
import { isReference, pointer } from "../../document/reader.js";
import type { NodeRef, Side } from "../../document/types.js";
import type { DocumentContext } from "../types.js";
import { applicators } from "./applicators.js";
import { combinations } from "./combinations.js";
import { checkDialect } from "./dialect.js";
import { keywords } from "./keywords.js";
import { changesResource } from "./locations.js";
import { type JsonBudget, passive, schemaObject } from "./reader.js";
import type { ReferenceIndex } from "./references.js";
import { typeStructure } from "./structure.js";
import type { JsonReader, JsonSchemaDialect } from "./types.js";

export class JsonWalk implements JsonReader {
	constructor(
		readonly context: DocumentContext,
		readonly side: Side,
		readonly dialect: JsonSchemaDialect,
		private readonly index: ReferenceIndex,
		private readonly budget: JsonBudget,
	) {}
	read(source: unknown, key: string | number, path: string): unknown {
		return passive(source, key, path, this);
	}
	has(source: unknown, key: string): boolean {
		return isReference(source) && Object.hasOwn(source, key);
	}
	take(path: string): boolean {
		return this.budget.take(this.side, path);
	}
	diagnose(code: string, path: string): void {
		this.context.diagnose(code, this.side, path);
	}
	unknown(path: string, reason: string): NodeRef {
		return this.context.node(this.side, path, () => ({ kind: "unknown", reason }));
	}

	visit(source: unknown, path: string): NodeRef {
		return this.context.visit(source, this.side, path, () => {
			if (!this.take(path)) return { kind: "unknown", reason: "json-traversal-limit" };
			try {
				return this.build(source, path);
			} catch {
				this.diagnose("JSON_INSPECTION_FAILED", path);
				return { kind: "unknown", reason: "json-inspection-failed" };
			}
		});
	}

	private build(source: unknown, path: string): SchemaNode {
		if (typeof source === "boolean") return source ? { kind: "unconstrained", domain: "json" } : { kind: "never" };
		if (!schemaObject(source)) {
			this.diagnose("JSON_INVALID_SCHEMA", path);
			return { kind: "unknown", reason: "invalid-json-schema" };
		}
		checkDialect(source, path, this);
		if (changesResource(source, path, this.dialect)) this.diagnose("JSON_RESOURCE_REBASE_UNSUPPORTED", path);
		const annotations = keywords(source, path, this);
		if (this.dialect === "draft-07" && this.has(source, "$ref"))
			return { ...this.reference(source, "$ref", path), metadata: annotations.metadata };
		const parts = this.parts(source, path);
		const structural = parts.length === 1 ? parts[0] : this.intersection(parts, path);
		return { ...structural, ...annotations, applicators: applicators(source, path, this) };
	}

	private parts(source: object, path: string): SchemaNode[] {
		const parts = combinations(source, path, this);
		const structure = typeStructure(source, path, this);
		if (structure) parts.unshift(structure);
		for (const key of ["$ref", "$dynamicRef", "$recursiveRef"]) {
			if (this.has(source, key)) parts.push(this.reference(source, key, path));
		}
		return parts;
	}

	private intersection(parts: SchemaNode[], path: string): SchemaNode {
		if (!parts.length) return { kind: "unconstrained", domain: "json" };
		return { kind: "intersection", operands: parts.map((part) => this.context.node(this.side, path, () => part)) };
	}

	private reference(source: object, key: string, path: string): SchemaNode {
		const reference = this.read(source, key, path);
		if (typeof reference !== "string") {
			this.diagnose("JSON_INVALID_REFERENCE", pointer(path, key));
			return { kind: "ref", reference: "<unavailable>", unresolved: "invalid-reference" };
		}
		const resolution =
			key === "$ref" ? this.index.resolve(reference, source, path) : { reason: "dynamic-reference-unsupported" };
		if (resolution.reason !== undefined) {
			this.diagnose("JSON_UNRESOLVED_REFERENCE", pointer(path, key));
			return { kind: "ref", reference, unresolved: resolution.reason };
		}
		return { kind: "ref", reference, target: this.visit(resolution.location.source, resolution.location.pointer) };
	}
}
