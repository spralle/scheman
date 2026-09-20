# #33 implementation checkpoint — not release-ready

Tracking: <https://github.com/spralle/scheman/issues/33>. The architecture comment
`5752626754` remains the source of truth. Status: **in_progress**.

## Implemented internal foundation

The new source modules are intentionally not exported from the package entry point
yet. Existing public ingestion and helper entry points are unchanged; the public
`SchemaErrorCode` type adds `SCHEMA_INVALID_OPTIONS` and `SCHEMA_INVALID_PROVIDER`.
Do not import these
internal modules as a supported consumer API.

- `document/`: immutable graph types, descriptor-based reads, bounded ownership
  copying, diagnostics, node validation and a per-ingestion graph builder.
- `providers/types.ts`: explicit provider contract and a frozen capability-only
  context; providers cannot obtain the builder's node table or finish a document.
- `ingest-document.ts`: synchronous explicit-provider entry implementation.
- `standard.ts`: official `@standard-schema/spec@1.1.0` types and passive
  own-descriptor validator inspection.
- `providers/standard-schema.ts`: independent validation-only provider.

The document is the serialization boundary. The optional validator is the
original live Standard Schema object, not a clone or wrapper, and is not frozen.
Ingestion does not invoke validation. Consumers retain its original receiver by
calling `result.validator['~standard'].validate(...)` themselves.

### Kernel invariants and current budget semantics

- Reserve node IDs before traversal; cache object identities independently for
  input and output. Recursive references are edges, never JavaScript cycles.
- All structural edges must originate from the current context. Malformed nodes,
  forged references, pending failed reservations and late context writes fail
  with `SchemaError`. Graph construction snapshots only defined node fields.
- Returned records and arrays are owned and deeply frozen. Caller schemas,
  metadata, and validator functions remain unfrozen. Prototype-sensitive keys
  are retained in null-prototype records.
- Accessors, `toJSON`, functions and coercion hooks are not invoked by copying.
  Unsupported metadata is tagged or diagnosed; symbolic keys are diagnosed and
  omitted. Cyclic metadata becomes an unavailable marker, not a JavaScript cycle.
- Default budgets match the architecture. Hard ceilings are enforced. Metadata
  bytes count UTF-16 string/key storage; entries count copying work, not final
  serialized JSON punctuation or fixed marker overhead. Structural text and
  structural list entries have additional conservative global bounds.
- The unknown sentinel counts toward `maxNodes`; two root edges are reserved
  before traversal. **Current design decision requiring architecture/audit
  confirmation:** `maxEdges: 1` is rejected, because every valid document has two
  mandatory root edges. All other positive overrides are accepted within their
  ceilings. No approved exception is being claimed for this clarification.
- Traversal can truncate conservatively before exhausting every visible output
  slot: work spent on a subsequently truncated node is not refunded. Caps are
  global across sides; diagnostics reserve a final truncation-summary slot.
- Providers are trusted synchronous code. They must stop source traversal when
  `context.available()` is false. The kernel bounds returned artifacts, not
  arbitrary provider execution time. Descriptor inspection can execute Proxy
  traps; key enumeration and already allocated inputs cannot have hard CPU/heap
  guarantees. This is not a sandbox.

## Required remaining work (all still owned by #33)

1. JSON Schema provider: dialect-correct structure, applicators, definitions,
   pointer/anchor reference graph, safe retained unsupported keywords, dialect
   and resource-rebasing diagnostics, and all architecture fixtures.
2. Separate Zod 3 and Zod 4 readers and per-call execution caches/policies;
   complete the graph matrix on 3.24.0, 3.25.76, 4.0.0 and 4.1.5. Existing Zod
   tests still exercise legacy behavior and are not new-provider coverage.
3. Independent Standard JSON conversion provider with explicit permission,
   target/receiver propagation, and independent input/output failures.
4. Replace public exports and local legacy types; delete old flat ingestion,
   extractors, registry, autodetection and eager dereferencing. Retain unrelated
   metadata/middleware/error helpers and their tests. Do not close #27.
5. README, consumer migration-v2 guide and packed migration/release notes. A
   **major** changeset reserves the user-approved release, but its checkpoint
   description must be replaced with final consumer-facing breaking-change notes
   during integration. The actual breaking entry-point replacement is unfinished;
   this branch is not ready to merge or release.
6. Actual packed-artifact `test:package`: ESM, CJS, NodeNext/bundler declarations,
   Zod absent/present, removed exports, and actual headless-browser execution.
   No browser or packed-consumer success is claimed by this checkpoint.
7. Full required gates, issue `implemented` update, independent Auditor, then
   Diplomat PR/release workflow. No merge or publication from Engineer.

## Focused checks

```sh
bun run test
bunx tsc -p packages/core/tsconfig.document-tests.json
bun scripts/check-document-principles.mjs
```

The declaration fixture checks official validation options, structured issue
paths, preserved input/output inference, required provider selection and readonly
roots. It is not the required packed-artifact declaration smoke test.

No Formbar files or release infrastructure were changed. The checkpoint is an
implementation continuation handoff, not approval to audit/release a completed v2.

## Checkpoint validation (2026-09-20)

Tools: Bun 1.4.2, Node v24.21.0, npm 11.19.0, Vitest 3.2.4, tsup 8.5.1.

| Command | Result |
| --- | --- |
| `bun install --frozen-lockfile` | Pass after intentional dependency/lock update |
| `bun run lint` | Pass |
| `bun run typecheck` | Pass |
| `bunx tsc -p packages/core/tsconfig.document-tests.json` | Pass |
| `bun run test` | Pass: 11 files, 167 tests (45 new document tests) |
| `bun run build` | Pass; builds the unchanged legacy entry point, not the new internal API |
| `bun scripts/check-document-principles.mjs` | Pass: 13 new production files; maximum 193 lines/file, 23 lines/function, nesting 2 |
| `git diff --check` | Pass |
| `bun run test:package` | Fail: script not implemented yet |
| `npm publish --dry-run --access public --workspace=@scheman/core` | Fail: npm 11.19.0 rejects already-published 1.0.0 after constructing the package preview. No version bump or publication performed. |

The lockfile updater also synchronized its stale workspace version from 0.1.0 to
the manifest's existing 1.0.0; the manifest version was not changed. Initial
typecheck/lint errors in the new code were corrected before the passing gates.
The dry-run also reported the existing repository-URL normalization warning; no
unrelated manifest cleanup was performed.

The principles checklist passes for the implemented production slice: cohesive
files, bounded function/size/nesting metrics, intent-only comments, risk-based
tests, and passing lint/typecheck/tests. No approved exceptions. There is one
documented lint suppression for an internal JSON `then` keyword parser table,
which never crosses an async boundary. The `maxEdges` minimum clarification
above still needs architectural/audit confirmation. Full #33 correctness and
release acceptance remain unchecked because the required work is incomplete.
