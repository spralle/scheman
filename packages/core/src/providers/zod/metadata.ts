import { data } from "../../document/reader.js";
import type { OwnedValue } from "../../document/types.js";
import type { Walk } from "./types.js";

export function metadata(source: unknown, definition: unknown, state: Walk): OwnedValue {
	const annotations: Record<string, unknown> = Object.create(null);
	const description = data(definition, "description");
	if (description !== undefined) annotations.description = description;
	const extensions = data(definition, "metadata") ?? data(source, "metadata");
	if (extensions !== undefined) annotations.extensions = extensions;
	const meta = data(source, "meta");
	if (state.reader.version === 4 && typeof meta === "function") {
		const value = state.resolve(source, "metadata", () => meta.call(source));
		if (value !== undefined) annotations.annotations = value;
	}
	return state.context.copy(annotations, state.side, state.path);
}
