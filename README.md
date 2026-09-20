# Scheman

Explicit schema ingestion into an owned, recursive **SchemaDocument** graph.
JSON Schema (draft-07 and 2020-12), Zod 3/4, Standard Schema validation handles,
and Standard JSON Schema conversion share one synchronous entry point.

```sh
npm install @scheman/core
# Only if your application uses Zod:
npm install zod
```

## JSON Schema and graph traversal

```ts
import { ingestSchemaDocument, jsonSchemaProvider } from "@scheman/core";

const { document } = ingestSchemaDocument({
	type: "object",
	properties: { name: { type: "string" }, next: { $ref: "#" } },
	required: ["name"],
}, { provider: jsonSchemaProvider({ dialect: "draft-2020-12" }) });

const root = document.nodes[document.root.input.nodeId];
if (root?.kind === "object") {
	for (const property of root.properties) {
		const child = document.nodes[property.node.nodeId];
		console.log(property.name, property.presence, child?.kind);
		if (child?.kind === "ref" && child.target) {
			console.log("Reference target", child.target.nodeId);
		}
	}
}
console.log(document.capabilities, document.diagnostics);
const serializedDocument = JSON.stringify(document); // cycles are NodeRefs, not JS cycles
```

There is no flat field list. Nodes preserve arrays, tuples/rest, objects, records,
ordered unions/intersections, references, wrappers, JS primitives, and unknowns.
Use a visited-node set for recursive traversal (see the migration guide).
Property presence is local; optional parents do not make every child optional.
`unknown`, `unconstrained`, and `never` are different states.

## Zod: explicitly trust structural callbacks

```ts
import { z } from "zod";
import { ingestSchemaDocument, zod4Provider } from "@scheman/core";

const schema = z.object({ name: z.string(), age: z.number().optional() });
const result = ingestSchemaDocument(schema, {
	provider: zod4Provider({ execution: { shape: "allow", lazy: "allow", metadata: "deny" } }),
});
console.log(result.document.root, result.document.capabilities);
// Validation is separate, explicit, and uses the original live object/receiver.
if (result.validator) {
	const validation = await result.validator["~standard"].validate({ name: "Ada" });
	console.log(validation);
}
```

For Zod 3 use `zod3Provider` with the same options. `shape`, `lazy`, and `metadata`
each default to **deny**. Denied structure is diagnosed, not silently empty.
Approved calls are cached once per source/category per ingestion across both sides.
Defaults, catches, validation, refinements, and transformations are never executed
by the built-in Zod readers. A trusted shape/lazy/meta callback can itself execute
user code indirectly; permission is not a sandbox or synchronous timeout.

Tested Zod releases: **3.24.0, 3.25.76, 4.0.0, 4.1.5**. The optional peer range is
`>=3.24.0 <4 || >=4.0.0 <5`; other releases are best-effort, not a proven matrix.
Scheman never imports Zod at runtime. Zod 3.24 has no fabricated Standard validator.

## Validation-only and unknown sides

```ts
import { ingestSchemaDocument, standardSchemaProvider, type StandardSchemaV1 } from "@scheman/core";

const schema: StandardSchemaV1<string, number> = {
	"~standard": {
		version: 1, vendor: "example",
		validate: value => typeof value === "string"
			? { value: value.length }
			: { issues: [{ message: "Expected string", path: [{ key: "value" }] }] },
	},
};
const result = ingestSchemaDocument(schema, { provider: standardSchemaProvider() });
console.log(result.document.capabilities); // input/output: unavailable
console.log(result.document.nodes[result.document.root.input.nodeId]); // unknown
const validation = await result.validator?.["~standard"].validate("hello");
// result.validator retains StandardSchemaV1<string, number> inference.
```

The validator is optional, original, live, and outside the frozen document. It is
never probed. Serialize `document`, not the result envelope. Official types come
from `@standard-schema/spec` (a declaration dependency, no runtime import).

## Explicit Standard JSON conversion

```ts
import { ingestSchemaDocument, standardJsonSchemaProvider, type StandardJSONSchemaV1 } from "@scheman/core";

const schema: StandardJSONSchemaV1<string, number> = {
	"~standard": { version: 1, vendor: "example", jsonSchema: {
		input: options => ({ type: "string", description: options.target }),
		output: () => ({ type: "number" }),
	} },
};
const { document } = ingestSchemaDocument(schema, {
	provider: standardJsonSchemaProvider({ target: "draft-2020-12", execution: "allow" }),
});
console.log(document.root.input, document.root.output);
```

Conversion requires an explicit target and `allow` or `deny`. Input/output methods
run independently once with their original receiver. A failed side becomes unknown;
the successful side is never copied over it. A conversion-only object needs no validator.

## Safety and fidelity

- Returned documents contain deeply frozen, owned serializable records/arrays.
  Metadata is node-local; exact extension keys are retained without UI aliases.
- Built-in generic reads inspect own descriptors, not arbitrary getters or `toJSON`.
  Proxy traps can still execute; this is not a security sandbox.
- Capabilities describe structural availability, **not equivalent validation**.
  Inspect diagnostics and unknown/opaque nodes before relying on structure.
- Finite budgets span both sides. Defaults: depth 128, nodes 10,000, definitions
  2,000, diagnostics 200, edges 50,000, metadata entries 20,000, metadata bytes
  1,048,576. Overrides have safe ceilings; `maxEdges` must be at least 2 for the two
  root edges. Limits do not guarantee CPU/heap bounds for proxies, existing huge
  objects, or trusted callbacks.
- No external reference loading, `$id` resource rebasing, dynamic-ref evaluation,
  flattening shim, validation implementation, or arbitrary-JS lossless round trip.

Retained caller-trusted utilities: `mergeMetadata`, `mergeSamePrecedence`,
`structuralEqual`, `applySchemaMiddleware`, `checkType`, `isObject`, `SchemaError`.
Their existing trusted-data semantics are separate from ingestion safety/ownership.
`MetadataSource`/`MergeInput` are general metadata records, not field extraction types.

## Migrating from v1

This is a breaking replacement of `ingestSchema`, extractors, autodetection, the
global registry, eager dereferencing, and flat field types. See
[migration and v2 release notes](https://github.com/spralle/scheman/blob/main/docs/migration-v2.md)
(also packaged as `MIGRATION.md`). Custom integrations implement the per-call
`SchemaDocumentProvider`/bounded `DocumentContext` contract, not a global extractor.

## Development

```sh
bun install --frozen-lockfile
bun run lint
bun run typecheck
bun run test
bun run test:principles
bun run build
bunx playwright install --with-deps chromium
bun run test:package
```

The package test installs the real tarball in a temporary clean consumer, checks
ESM/CJS and NodeNext/bundler declarations, tests Zod absent and all four pinned
versions present, and runs graph/validator assertions in headless Chromium.
For a system Chromium use `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chromium`;
the runner also falls back to `/usr/bin/chromium` if the managed browser is absent.

MIT
