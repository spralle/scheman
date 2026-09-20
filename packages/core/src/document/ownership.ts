import type { DocumentLimits } from "./limits.js";
import { data, entries } from "./reader.js";
import type { OwnedValue } from "./types.js";

export class Ownership {
	private count = 0;
	private bytes = 0;
	private active = new WeakSet<object>();
	constructor(
		private readonly limits: DocumentLimits,
		private readonly report: (code: string) => void,
	) {}

	copy(value: unknown, depth = 0): OwnedValue {
		if (!this.take(0) || depth > this.limits.maxDepth) return this.unavailable("METADATA_LIMIT");
		if (value === null || typeof value === "boolean") return value;
		if (typeof value === "string") return this.text(value);
		if (typeof value === "number" && Number.isFinite(value))
			return Object.is(value, -0) ? this.tag("negative-zero") : value;
		if (typeof value === "number") return this.tag("number", String(value));
		if (value === undefined) return this.tag("undefined");
		if (typeof value === "bigint") return this.tag("bigint", this.text(String(value)));
		if (typeof value !== "object") return this.unavailable("METADATA_NON_JSON", typeof value);
		if (this.active.has(value)) return this.unavailable("METADATA_CYCLE");
		const prototype = Object.getPrototypeOf(value);
		if (Object.getOwnPropertySymbols(value).length) this.report("METADATA_SYMBOL_KEYS");
		if (!Array.isArray(value) && prototype !== null && prototype !== Object.prototype)
			return this.unavailable("METADATA_NON_JSON");
		this.active.add(value);
		try {
			return Object.freeze(Array.isArray(value) ? this.array(value, depth) : this.record(value, depth));
		} finally {
			this.active.delete(value);
		}
	}

	private array(value: unknown[], depth: number): OwnedValue[] {
		const result: OwnedValue[] = [];
		const length = data(value, "length") as number;
		for (let index = 0; index < length; index++) {
			if (!this.take(0)) {
				this.report("METADATA_LIMIT");
				break;
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, index);
			result.push(
				descriptor && !("value" in descriptor)
					? this.unavailable("METADATA_ACCESSOR")
					: this.copy(data(value, index), depth + 1),
			);
		}
		return result;
	}

	private record(value: object, depth: number): Record<string, OwnedValue> {
		const result: Record<string, OwnedValue> = Object.create(null);
		for (const [key, item] of entries(value)) {
			if (!this.take(key.length * 2)) {
				this.report("METADATA_LIMIT");
				break;
			}
			const descriptor = Object.getOwnPropertyDescriptor(value, key);
			result[key] =
				descriptor && !("value" in descriptor) ? this.unavailable("METADATA_ACCESSOR") : this.copy(item, depth + 1);
		}
		return result;
	}

	private text(value: string): OwnedValue {
		return this.take(value.length * 2) ? value : this.unavailable("METADATA_LIMIT");
	}

	private take(bytes: number): boolean {
		if (this.exhausted() || bytes > this.limits.maxMetadataBytes - this.bytes) return false;
		this.count++;
		this.bytes += bytes;
		return true;
	}

	private exhausted(): boolean {
		return this.count >= this.limits.maxMetadataEntries || this.bytes >= this.limits.maxMetadataBytes;
	}

	private unavailable(code: string, type?: string): OwnedValue {
		this.report(code);
		return this.tag("unavailable", type ?? code);
	}

	private tag(type: string, value?: OwnedValue): OwnedValue {
		return Object.freeze(value === undefined ? { $type: type } : { $type: type, value });
	}
}
