import * as core from "@scheman/core";
import { z } from "zod";
import { check } from "./smoke.mjs";

const provider = process.argv[2].startsWith("3") ? core.zod3Provider : core.zod4Provider;
let defaults = 0;
const recursive = z.object({
	label: z.string().default(() => {
		defaults++;
		return "label";
	}),
	next: z.lazy(() => recursive).optional(),
});
const result = core.ingestSchemaDocument(recursive, {
	provider: provider({ execution: { shape: "allow", lazy: "allow" } }),
});
const root = result.document.nodes[result.document.root.input.nodeId];
check(root.kind === "object" && root.properties.length === 2, "Packed Zod object graph");
check(defaults === 0, "Packed Zod default factory not called");
check(JSON.stringify(result.document).length > 0, "Packed recursive Zod serialization");
check(
	Object.values(result.document.nodes).some((node) => node.kind === "ref" && node.target),
	"Packed Zod lazy reference",
);
check(result.validator === recursive, "Original observable Standard validator");
const presence = core.ingestSchemaDocument(z.object({ x: z.literal(undefined).nullable() }), {
	provider: provider({ execution: { shape: "allow" } }),
}).document;
const enumeration = core.ingestSchemaDocument(z.nativeEnum({ One: "A", A: 1 }), { provider: provider() }).document;
let getters = 0;
const literal = z.literal("x");
const v3 = process.argv[2].startsWith("3");
Object.defineProperty(v3 ? literal._def : literal._def.values, v3 ? "value" : "0", {
	get() {
		getters++;
		throw new Error("forbidden");
	},
});
const unreadable = core.ingestSchemaDocument(literal, { provider: provider() }).document;
for (const side of ["input", "output"]) {
	const object = presence.nodes[presence.root[side].nodeId];
	check(object.kind === "object" && object.properties[0].presence === "optional", "Packed literal undefined presence");
	const values = enumeration.nodes[enumeration.root[side].nodeId];
	check(
		values.kind === "enum" && JSON.stringify(values.values) === JSON.stringify(v3 ? [1] : ["A", 1]),
		"Packed version-specific enum values",
	);
	check(unreadable.nodes[unreadable.root[side].nodeId].kind === "unknown", "Packed unreadable literal");
}
check(getters === 0, "Packed literal getter nonexecution");
console.log(`PASS packed Zod ${process.argv[2]}`);
