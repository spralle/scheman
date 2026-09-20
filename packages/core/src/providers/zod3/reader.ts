import { data } from "../../document/reader.js";
import type { ZodReader } from "../zod/types.js";

export const zod3Reader: ZodReader = {
	version: 3,
	definition: (source) => data(source, "_def"),
	kind: (definition) => {
		const name = data(definition, "typeName");
		return typeof name === "string" ? name.replace(/^Zod/, "").toLowerCase() : "unrecognized";
	},
	arrayElement: (definition) => data(definition, "type"),
	recordExhaustive: () => false,
	shape: (source, definition, state) => {
		const shape = data(definition, "shape");
		return typeof shape === "function" ? state.resolve(source, "shape", () => shape.call(definition)) : shape;
	},
};
