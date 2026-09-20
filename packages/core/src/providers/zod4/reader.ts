import { data, isReference } from "../../document/reader.js";
import type { ZodReader } from "../zod/types.js";

export const zod4Reader: ZodReader = {
	version: 4,
	definition: (source) => data(data(source, "_zod"), "def"),
	kind: (definition) => {
		const name = data(definition, "type");
		return typeof name === "string" ? name : "unrecognized";
	},
	arrayElement: (definition) => data(definition, "element"),
	recordExhaustive: (key) => {
		const internal = data(key, "_zod");
		if (!isReference(internal)) return "unknown";
		const descriptor = Object.getOwnPropertyDescriptor(internal, "values");
		if (!descriptor) return false;
		if (!("value" in descriptor)) return "unknown";
		if (descriptor.value === undefined) return false;
		return hasFiniteKeys(descriptor.value);
	},
	shape: (source, definition, state) => {
		if (!isReference(definition)) return undefined;
		const descriptor = Object.getOwnPropertyDescriptor(definition, "shape");
		if (descriptor && "value" in descriptor) return descriptor.value;
		const getter = descriptor?.get;
		return getter ? state.resolve(source, "shape", () => getter.call(definition)) : undefined;
	},
};
function hasFiniteKeys(value: unknown): boolean | "unknown" {
	try {
		Set.prototype.has.call(value, undefined);
		return true;
	} catch {
		return "unknown";
	}
}
