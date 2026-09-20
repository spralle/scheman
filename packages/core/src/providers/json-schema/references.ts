import { data, isReference, pointer } from "../../document/reader.js";
import type { Side } from "../../document/types.js";
import type { DocumentContext } from "../types.js";
import { changesResource, children, localAnchor, referenceOnly } from "./locations.js";
import { type JsonBudget, passive, schemaObject } from "./reader.js";
import type { IndexedDefinition, JsonSchemaDialect, Location } from "./types.js";

export type Resolution =
	| { readonly location: Location; readonly reason?: never }
	| { readonly reason: string; readonly location?: never };

export class ReferenceIndex {
	readonly definitions: IndexedDefinition[] = [];
	private readonly seen = { local: new WeakSet<object>(), rebased: new WeakSet<object>() };
	private readonly rebased = new WeakSet<object>();
	private readonly anchors = new Map<string, Location | null>();
	private complete = true;
	private indexExhausted = false;
	constructor(
		private readonly root: unknown,
		private readonly dialect: JsonSchemaDialect,
		private readonly context: DocumentContext,
		private readonly budget: JsonBudget,
		private readonly sides: readonly Side[] = ["input", "output"],
	) {}

	build(): void {
		try {
			this.scan({ source: this.root, pointer: "", rebased: false }, 0);
		} catch {
			this.complete = false;
			this.report("JSON_INSPECTION_FAILED", "");
		}
	}

	resolve(reference: string, source: unknown, path: string): Resolution {
		if (reference.length * 2 > this.context.limits.maxMetadataBytes) return { reason: "pointer-limit" };
		if ((isReference(source) && this.rebased.has(source)) || changesResource(source, path, this.dialect))
			return { reason: "resource-rebasing" };
		if (!reference.startsWith("#")) return { reason: "external-resource" };
		if (!this.complete) return { reason: "incomplete-reference-index" };
		let fragment: string;
		try {
			fragment = decodeURIComponent(reference.slice(1));
		} catch {
			return { reason: "invalid-fragment" };
		}
		if (!fragment) return { location: { source: this.root, pointer: "", rebased: false } };
		if (fragment.startsWith("/")) return this.resolvePointer(fragment);
		const anchor = this.anchors.get(fragment);
		if (!anchor) return { reason: anchor === null ? "ambiguous-anchor" : "missing-anchor" };
		return anchor.rebased ? { reason: "resource-rebasing" } : { location: anchor };
	}

	private scan(location: Location, depth: number): void {
		if (!schemaObject(location.source)) return;
		if (depth > this.context.limits.maxDepth) {
			this.complete = false;
			this.report("JSON_REFERENCE_INDEX_LIMIT", location.pointer);
			return;
		}
		if (!this.take(location.pointer)) return;
		const rebased = location.rebased || changesResource(location.source, location.pointer, this.dialect);
		const current = { ...location, rebased };
		if (rebased) this.rebased.add(location.source);
		const seen = rebased ? this.seen.rebased : this.seen.local;
		if (seen.has(location.source)) return;
		if (!this.budget.index()) {
			this.indexExhausted = true;
			if (this.complete) this.report("JSON_REFERENCE_INDEX_LIMIT", location.pointer);
			this.complete = false;
			return;
		}
		seen.add(location.source);
		this.indexAnchor(current);
		const scanContext = {
			diagnose: this.report.bind(this),
			take: this.take.bind(this),
			definition: this.definition.bind(this),
			read: this.read.bind(this),
		};
		for (const child of children(current, scanContext, this.dialect)) this.scan(child, depth + 1);
	}

	private indexAnchor(location: Location): void {
		if (location.rebased || referenceOnly(location.source, this.dialect)) return;
		this.read(location.source, this.dialect === "draft-07" ? "$id" : "$anchor", location.pointer);
		const name = localAnchor(location.source, this.dialect);
		if (!name) return;
		const previous = this.anchors.get(name);
		if (previous === undefined) this.anchors.set(name, location);
		else if (previous?.source !== location.source) this.anchors.set(name, null);
	}

	private definition(entry: IndexedDefinition): void {
		if (this.definitions.length < this.context.limits.maxDefinitions) this.definitions.push(entry);
		else this.report("JSON_DEFINITION_LIMIT", entry.pointer);
	}

	private take(path: string): boolean {
		if (this.indexExhausted) return false;
		if (this.budget.take(this.sides[0], path)) return true;
		if (this.complete) this.report("JSON_REFERENCE_INDEX_LIMIT", path);
		this.complete = false;
		return false;
	}

	private read(source: unknown, key: string | number, path: string): unknown {
		return passive(source, key, path, { diagnose: this.report.bind(this) });
	}

	private report(code: string, path: string): void {
		if (code === "JSON_ACCESSOR_UNAVAILABLE") this.complete = false;
		for (const side of this.sides) this.context.diagnose(code, side, path);
	}

	private resolvePointer(fragment: string): Resolution {
		if (fragment.length * 2 > this.context.limits.maxMetadataBytes) return { reason: "pointer-limit" };
		const parts = fragment.slice(1).split("/");
		if (parts.length > this.context.limits.maxDepth) return { reason: "pointer-limit" };
		let source = this.root;
		let path = "";
		for (const part of parts) {
			if (/~(?:[^01]|$)/.test(part)) return { reason: "invalid-pointer" };
			if (this.resourceBoundary(source, path)) return { reason: "resource-rebasing" };
			const key = part.replaceAll("~1", "/").replaceAll("~0", "~");
			if (Array.isArray(source) && !/^(0|[1-9][0-9]*)$/.test(key)) return { reason: "invalid-array-pointer" };
			if (!isReference(source) || !Object.hasOwn(source, key)) return { reason: "missing-pointer" };
			source = data(source, key);
			path = pointer(path, key);
		}
		if (changesResource(source, path, this.dialect)) return { reason: "resource-rebasing" };
		if (typeof source !== "boolean" && !schemaObject(source)) return { reason: "invalid-target" };
		return { location: { source, pointer: path, rebased: false } };
	}

	private resourceBoundary(source: unknown, path: string): boolean {
		if (!isReference(source)) return false;
		return (
			(this.seen.local.has(source) || this.seen.rebased.has(source)) && changesResource(source, path, this.dialect)
		);
	}
}
