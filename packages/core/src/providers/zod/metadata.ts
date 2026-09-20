import type { OwnedValue } from "../../document/types.js";
import { observed } from "./evidence.js";
import type { Walk } from "./types.js";

export function metadata(source: unknown, definition: unknown, state: Walk): OwnedValue {
	const annotations: Record<string, unknown> = Object.create(null);
	const read = (target: unknown, key: string) => observed(target, key, state, "zod.metadata-unreadable");
	const description = read(definition, "description");
	if (description !== undefined) annotations.description = description;
	const extensions = read(definition, "metadata") ?? read(source, "metadata");
	if (extensions !== undefined) annotations.extensions = extensions;
	const meta = state.reader.version === 4 ? read(source, "meta") : undefined;
	if (state.reader.version === 4 && typeof meta === "function") {
		const value = state.resolve(source, "metadata", () => meta.call(source));
		if (value !== undefined) annotations.annotations = value;
	}
	return state.context.copy(annotations, state.side, state.path);
}
