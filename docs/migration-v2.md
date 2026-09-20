# Migrating to Scheman v2 — release notes (#33)

v2 replaces flat field extraction with explicit, recursive schema documents.
There is deliberately no compatibility flattening API: flattening loses cycles,
alternatives, wrappers, local presence and input/output distinctions.

## Breaking API changes

| Removed in v2 | Migration |
| --- | --- |
| `ingestSchema(schema)` / `SchemaIngestionResult` | `ingestSchemaDocument(schema, { provider })` returns `{ document, validator? }` |
| `SchemaFieldInfo`, `SchemaFieldType`, `SchemaFieldMetadata`, `SchemaMetadata` | `SchemaNode`, `PropertyEdge`, node-local owned metadata, `SchemaDocument` |
| `extractFromJsonSchema`, `extractFromZod`, `extractFromZodV4` | `jsonSchemaProvider`, `zod3Provider`, `zod4Provider` |
| `SchemaExtractor`, `registerExtractor`, `findExtractor`, `clearExtractorRegistry`, `createValidationOnlyResult` | per-call `SchemaDocumentProvider`; `standardSchemaProvider` for validation-only |
| `dereferenceSchema` | graph `ref` nodes with source reference and target or unresolved reason |
| `isJsonSchema`, `isZodSchema`, `isZodV4Schema` | explicit provider selection, no autodetection |
| local Standard interface copies | official `StandardSchemaV1`, `StandardJSONSchemaV1` from `@standard-schema/spec` |

`isStandardSchema` remains but now checks the own passive version/vendor/validate
contract; `{ "~standard": null }` is false. `StandardSchemaIssue` and
`StandardSchemaResult` are exact official aliases. Inference uses
`schema['~standard'].types`, not the old incorrect top-level `~types`.
Official issue paths can include `{ key: PropertyKey }` segments and validation
supports the official options argument.

## Select the provider and side; follow references

```ts
import { ingestSchemaDocument, jsonSchemaProvider, type SchemaDocument, type NodeRef } from "@scheman/core";

const { document } = ingestSchemaDocument({
	type: "object", properties: { next: { $ref: "#" }, names: { type: "array", items: { type: "string" } } },
}, { provider: jsonSchemaProvider({ dialect: "draft-2020-12" }) });

// Enumerate structural edges, not metadata objects that happen to resemble refs.
function children(document: SchemaDocument, ref: NodeRef): NodeRef[] {
	const node = document.nodes[ref.nodeId];
	if (!node) return [];
	const edges: NodeRef[] = [];
	switch (node.kind) {
		case "object": edges.push(...node.properties.map(p => p.node)); if (node.additionalProperties) edges.push(node.additionalProperties); break;
		case "array": edges.push(node.items); break;
		case "tuple": edges.push(...node.items); if (node.rest) edges.push(node.rest); break;
		case "record": edges.push(node.key, node.value); break;
		case "union": edges.push(...node.alternatives); break;
		case "intersection": edges.push(...node.operands); break;
		case "ref": if (node.target) edges.push(node.target); break;
		case "wrapper": edges.push(node.inner); break;
	}
	const a = node.applicators;
	if (a) {
		for (const edge of [a.if, a.then, a.else, a.not, a.contains, a.propertyNames]) if (edge) edges.push(edge);
		edges.push(...Object.values(a.patternProperties ?? {}), ...Object.values(a.dependentSchemas ?? {}));
	}
	return edges;
}
const seen = new Set<string>();
const pending = [document.root.input]; // choose output separately
while (pending.length) {
	const ref = pending.pop()!;
	if (seen.has(ref.nodeId)) continue;
	seen.add(ref.nodeId);
	console.log(ref.nodeId, document.nodes[ref.nodeId]?.kind);
	pending.push(...children(document, ref));
}
// Unreachable definitions are indexed separately, with side/sourcePointer/name/node.
console.log(document.definitions);
```

IDs are deterministic for repeated traversal of an unchanged source, not content
hashes or identities across different schemas. Input/output roots may differ.
Do not collapse ordered `oneOf` into `anyOf`, merge `allOf` operands, or replace
unknown input/output with the known side. `complete` means structural availability,
not an executable validator equivalent to the source.

## Changed semantics

- Presence belongs to each object property edge (`required`, `optional`, `unknown`)
  and is separate from accepting undefined. JSON `required` names without a
  corresponding property schema are retained. Defaults are annotations/wrappers,
  never executed to manufacture values. `const` is not a default.
- Arrays retain items, tuples retain rest, unions retain alternatives, intersections
  retain all operands, and recursive references are not eagerly inlined.
- Unknown structure has explicit unknown/opaque nodes and diagnostics. A JSON
  boolean `true` is unconstrained; `false` is never. A date-formatted JSON string
  stays a string; Zod date, bigint, NaN, symbol and undefined remain distinct.
- JSON metadata uses `annotations`, exact-key `extensions`, `unsupported`, and
  draft-07 `ignoredSiblings`. Scalar/array extensions are retained. No stripping
  `x-`, UI aliases, or merging metadata across branches/sides.
- Draft-07 `$ref` siblings are ignored but retained; 2020-12 siblings remain
  conjunctive. Dialect defaults to 2020-12; specify draft-07 when appropriate.
  Unsupported/conflicting dialect evidence is diagnosed.
- Zod structure and metadata calls require independent permissions. Use
  `zod3Provider({ execution: { shape: 'allow', lazy: 'allow', metadata: 'allow' } })`
  or `zod4Provider` **only on trusted schemas**. Permissions default to deny.
  Generic accessors, validation, default/catch factories, refinements and transforms
  are never intentionally called by the readers. Approved callbacks can call them
  indirectly, so this is not a sandbox.
- Transform output and preprocess input may be unknown inside effect wrappers.
  Coercion/default/catch/refinement fidelity is partial. Unknown internals/checks
  are opaque/diagnosed, not treated as equivalent unconstrained schemas.

## Retain validation without executing it during ingestion

```ts
import { ingestSchemaDocument, standardSchemaProvider, type StandardSchemaV1 } from "@scheman/core";
const schema: StandardSchemaV1<string, number> = {
	"~standard": { version: 1, vendor: "example", validate: async value =>
		typeof value === "string" ? { value: value.length } : { issues: [{ message: "Expected string" }] } },
};
const result = ingestSchemaDocument(schema, { provider: standardSchemaProvider() });
// Both sides are unavailable/unknown; no structure is fabricated from validate.
console.log(result.document.capabilities);
console.log(result.validator === schema); // true, original object remains unfrozen
const validation = await result.validator?.["~standard"].validate("hello");
console.log(validation);
```

Use `standardJsonSchemaProvider({ target: 'draft-2020-12', execution: 'allow' })`
only when you explicitly trust conversion. It calls input/output independently
once, with target and optional `libraryOptions`, retaining a successful side when
the other fails. Conversion-only contracts do not need `validate`. No converter
fallback, validation probe, or fabricated validator is provided. A Zod object
without an observable official Standard contract has no returned validator; keep
your own parse handle if you need one. All four pinned fixtures, including 3.24.0,
do expose a passive Standard contract and retain their original validator.

## Custom providers replace the global registry

```ts
import { ingestSchemaDocument, type SchemaDocumentProvider } from "@scheman/core";
const provider: SchemaDocumentProvider = {
	name: "trusted-example",
	build(source, context) {
		const input = context.visit(source, "input", "", () => ({ kind: "primitive", type: "string" }));
		// Sharing is appropriate here only because this example has identical sides.
		return { input, output: input };
	},
};
console.log(ingestSchemaDocument({}, { provider }).document);
```

Providers are trusted synchronous code. `visit` reserves identity before building
children; `node` creates a new node. Use `copy`, `diagnose`, `capability`, `definition`
and `metadata` for owned contributions. Stop walking when `available()` is false.
Context methods validate/snapshot contributions; they do not expose a mutable node
table. Forged refs, malformed nodes, invalid options, and failed provider contracts
throw `SchemaError`. Source feature gaps produce partial documents/diagnostics.

## Ownership and limits

Only `document` is the serialization contract. It contains frozen arrays/plain
records and tagged/unavailable representations for unsupported JS metadata.
Metadata cycles are diagnosed and cut; there is no arbitrary-JS losslessness.
Caller schemas/metadata and original validators are not frozen or aliased into it.
Prototype-sensitive string keys are retained without prototype mutation.

| Budget | Default | Hard ceiling |
| --- | ---: | ---: |
| maxDepth | 128 | 256 |
| maxNodes | 10,000 | 100,000 |
| maxDefinitions | 2,000 | 20,000 |
| maxDiagnostics | 200 | 2,000 |
| maxEdges | 50,000 | 500,000 |
| maxMetadataEntries | 20,000 | 200,000 |
| maxMetadataBytes | 1,048,576 | 16,777,216 |

Pass overrides as `limits` alongside `provider`. Values must be positive safe
integers within ceilings; **maxEdges has minimum 2**, since the two root edges
exist even in an entirely unknown document. The unknown sentinel counts toward
nodes and the final diagnostic-summary slot counts toward diagnostics. Budgets are
global across both sides and can truncate conservatively (work is not refunded).
Metadata bytes count UTF-16 key/string storage, not serialized punctuation or
fixed marker overhead; entries count copying work. Structural lists/text have
additional conservative bounds. Truncation leaves no dangling references.

Descriptor inspection can invoke Proxy traps; key enumeration, already huge
objects and trusted callbacks are not hard CPU/heap/time bounded. The API is not
a hostile-code isolation boundary. Unrelated merge/equality/middleware utilities
remain caller-trusted and do not inherit the ingestion safety guarantee.

## Known boundaries, not validation promises

Optional future research is tracked in [#35](https://github.com/spralle/scheman/issues/35)
(JSON resources/vocabularies) and [#34](https://github.com/spralle/scheman/issues/34)
(additional passive Zod evidence). These are outside v2 scope, not missing core
acceptance items or promises to weaken execution safety.

- Local JSON Pointer fragments (URI decoding plus `~0`/`~1`), `#`, definitions and
  unambiguous local anchors are supported. External/network/file references,
  `$id` resource rebasing, `$dynamicRef`/`$dynamicAnchor` evaluation are not.
  Unsupported references remain unresolved with raw evidence and diagnostics.
- `unevaluatedProperties`/`unevaluatedItems` and unknown vocabularies are retained
  as unsupported metadata, not evaluated. Non-core Standard JSON targets are
  forwarded, but do not become supported graph dialects by implication.
- Tested Zod internals: 3.24.0/3.25.76/4.0.0/4.1.5. Erased v4 brands cannot gain
  invented names. Deferred v4 default output property presence is unknown. Zod
  4.0 partialRecord exhaustiveness is unknown when evidence requires a forbidden
  accessor; passive 4.1.5 evidence can report false. Checks retain vendor evidence,
  not an equivalent validation implementation.
- There is no flattening helper, UI interpretation, remote resolver or new vendor
  adapter. Formbar migration is outside this release and has not been edited.

Retained helpers: `mergeMetadata`, `mergeSamePrecedence`, `structuralEqual`,
`applySchemaMiddleware`/`SchemaMiddleware`, `checkType`, `isObject`, `SchemaError`.
Their `MetadataSource`/`MergeInput` types remain meaningful general record types,
independent of graph nodes. `JsonSchema` now includes booleans: middleware that
spreads or reads properties must first narrow `typeof schema !== 'boolean'`.

## Release validation

The major Changeset is the versioning authority; manifests are not manually
bumped. #33 tracks integration/audit; #27's old JSON walker is deleted, and its
closure remains a Builder decision. The package ships ESM/CJS plus matching
declarations, this guide and the README. `test:package` verifies an actual tarball
with clean consumers, absent/present optional Zod peers, official type inference,
legacy export removal, recursive serialization, explicit validation, and actual
headless-browser graph execution. This guide's TypeScript examples are compiled
against the packed artifact as part of that gate.
