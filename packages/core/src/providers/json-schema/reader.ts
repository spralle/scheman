import { data, entries, isReference, pointer } from "../../document/reader.js";
import type { Side } from "../../document/types.js";
import type { DocumentContext } from "../types.js";
import type { JsonReader } from "./types.js";

export function schemaObject(value: unknown): value is object {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const prototype = Object.getPrototypeOf(value);
	return prototype === null || prototype === Object.prototype;
}

export function passive(
	source: unknown,
	key: string | number,
	path: string,
	reader: Pick<JsonReader, "diagnose">,
): unknown {
	if (!isReference(source)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(source, key);
	if (descriptor && !("value" in descriptor)) reader.diagnose("JSON_ACCESSOR_UNAVAILABLE", pointer(path, key));
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

export function* objectEntries(
	value: unknown,
	path: string,
	reader: JsonReader,
): Generator<readonly [string, unknown]> {
	if (!schemaObject(value)) {
		reader.diagnose("JSON_INVALID_KEYWORD", path);
		return;
	}
	for (const [key] of entries(value)) {
		if (!reader.take(path)) return;
		yield [key, reader.read(value, key, path)];
	}
}

export function* arrayEntries(value: unknown, path: string, reader: JsonReader): Generator<readonly [number, unknown]> {
	if (!Array.isArray(value)) {
		reader.diagnose("JSON_INVALID_KEYWORD", path);
		return;
	}
	const length = data(value, "length") as number;
	for (let index = 0; index < length; index++) {
		if (!reader.take(path)) return;
		yield [index, reader.read(value, index, path)];
	}
}

export class JsonBudget {
	private remaining: number;
	private indexRemaining: number;
	private readonly reported = new Set<Side>();
	constructor(private readonly context: DocumentContext) {
		this.remaining = context.limits.maxEdges;
		this.indexRemaining = context.limits.maxNodes - 1;
	}
	index(): boolean {
		return this.indexRemaining-- > 0;
	}
	take(side: Side, path: string): boolean {
		if (this.remaining-- > 0 && this.context.available()) return true;
		if (!this.reported.has(side)) {
			this.reported.add(side);
			this.context.diagnose("JSON_TRAVERSAL_LIMIT", side, path);
		}
		return false;
	}
}
