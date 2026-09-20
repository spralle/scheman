import { data, isReference } from "../../document/reader.js";
import { SchemaError } from "../../errors.js";
import type { ZodProviderOptions } from "./types.js";

type Category = "shape" | "lazy" | "metadata";
type Resolution = { value?: unknown; failed?: boolean };
export function executionPolicy(options: ZodProviderOptions) {
	const execution = data(options, "execution");
	const result = { shape: false, lazy: false, metadata: false };
	if (!isReference(options) || accessor(options, "execution")) invalid();
	if (execution !== undefined && !isReference(execution)) invalid();
	for (const category of ["shape", "lazy", "metadata"] as const) {
		const value = data(execution, category);
		if (isReference(execution) && accessor(execution, category)) invalid();
		if (value !== undefined && value !== "allow" && value !== "deny") invalid();
		result[category] = value === "allow";
	}
	return result;
}
function accessor(source: object, key: string): boolean {
	const descriptor = Object.getOwnPropertyDescriptor(source, key);
	return descriptor !== undefined && !("value" in descriptor);
}
function invalid(): never {
	throw new SchemaError("SCHEMA_INVALID_OPTIONS", "Zod execution policies must be passive allow/deny values");
}
export function executionCache(policy: ReturnType<typeof executionPolicy>) {
	const caches = {
		shape: new WeakMap<object, Resolution>(),
		lazy: new WeakMap<object, Resolution>(),
		metadata: new WeakMap<object, Resolution>(),
	};
	return (source: unknown, category: Category, callback: () => unknown, report: (code: string) => void) => {
		if (!policy[category]) {
			report(`zod.execution.${category}.denied`);
			return undefined;
		}
		if (!isReference(source)) return undefined;
		const cache = caches[category];
		if (!cache.has(source)) {
			try {
				cache.set(source, { value: callback() });
			} catch {
				cache.set(source, { failed: true });
			}
		}
		const result = cache.get(source);
		if (result?.failed) report(`zod.execution.${category}.failed`);
		return result?.value;
	};
}
