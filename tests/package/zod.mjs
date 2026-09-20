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
console.log(`PASS packed Zod ${process.argv[2]}`);
