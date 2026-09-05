import { describe, expect, it } from "vitest";
import { z as z3Min } from "zod3-min";
import { z as z4Min } from "zod4-min";
import { ingestSchema } from "../index.js";

describe("exact minimum supported Zod versions", () => {
	it("ingests Zod 3.24 objects, leaves, enums, defaults, pipelines, and lazy schemas", () => {
		const Native = { One: "one", Two: "two" } as const;
		const schema = z3Min.object({
			name: z3Min.string(),
			status: z3Min.enum(["new", "done"]),
			nativeStatus: z3Min.nativeEnum(Native),
			defaulted: z3Min.literal("saved").default("saved"),
			piped: z3Min.string().pipe(z3Min.string()),
			lazy: z3Min.lazy(() => z3Min.number()),
		});
		const result = ingestSchema(schema);

		expect(result.metadata.vendor).toBe("zod");
		expect(result.fields).toMatchObject([
			{ path: "name", type: "string" },
			{ path: "status", type: "enum", metadata: { enum: ["new", "done"] } },
			{ path: "nativeStatus", type: "enum", metadata: { enum: ["one", "two"] } },
			{ path: "defaulted", type: "string", required: false, defaultValue: "saved" },
			{ path: "piped", type: "string" },
			{ path: "lazy", type: "number" },
		]);
	});

	it("ingests Zod 4.0 objects, leaves, enums, defaults, pipes, and lazy schemas", () => {
		const Native = { One: "one", Two: "two" } as const;
		const schema = z4Min.object({
			name: z4Min.string(),
			status: z4Min.enum(["new", "done"]),
			nativeStatus: z4Min.nativeEnum(Native),
			defaulted: z4Min.literal("saved").default("saved"),
			piped: z4Min.string().pipe(z4Min.string()),
			lazy: z4Min.lazy(() => z4Min.number()),
		});
		const result = ingestSchema(schema);

		expect(result.metadata.vendor).toBe("zod4");
		expect(result.fields).toMatchObject([
			{ path: "name", type: "string" },
			{ path: "status", type: "enum", metadata: { enum: ["new", "done"] } },
			{ path: "nativeStatus", type: "enum", metadata: { enum: ["one", "two"] } },
			{ path: "defaulted", type: "string", required: false, defaultValue: "saved" },
			{ path: "piped", type: "string" },
			{ path: "lazy", type: "number" },
		]);
	});
});
