# @scheman/core

## 2.0.0

### Major Changes

- 0585e00: Replace flat schema extraction with recursive, owned schema documents (#33).

  **Breaking:** replace `ingestSchema` and all `extractFrom*` functions with `ingestSchemaDocument(schema, { provider })`. Remove the global extractor registry, autodetection, eager `dereferenceSchema`, and flat field/result types. No flattening compatibility API is provided.

  Select JSON Schema, Zod 3/4, validation-only Standard Schema, or explicit Standard JSON conversion providers per call. Documents retain input/output roots, recursive/shared references, ordered alternatives, wrappers, local presence, node metadata, per-side availability, and diagnostics. Built-in Zod shape/lazy/metadata execution defaults to deny; trusted calls require independent opt-in. Defaults, transforms and validation are not probed. Original official Standard validators remain live outside the frozen serializable document with generic inference intact.

  JSON Schema supports draft-07 and 2020-12 with local pointer/anchor references; external references, resource rebasing and dynamic evaluation remain explicit unsupported evidence. Bounded graph construction and owned metadata do not provide a hostile-code sandbox. Zod is optional and never imported by the library; tested versions are 3.24.0, 3.25.76, 4.0.0 and 4.1.5.

  Property presence preserves passive undefined literals, including unions and nullable wrappers; deferred Zod 4 defaults inside optional wrappers keep unknown output presence. Native enum values follow version-specific reverse-mapping rules. Unreadable literal, constraint, and metadata evidence is diagnosed rather than presented as known undefined or complete structure. Anchor discovery ignores out-of-dialect annotation payloads.

  Retained merge/equality/error utilities keep their caller-trusted semantics. JSON middleware now accepts boolean schemas, so object-only middleware must narrow first. Official Standard types are re-exported from `@standard-schema/spec`. See the packaged `MIGRATION.md` for removed names, complete migration examples, limits, and fidelity boundaries.

## 1.0.0

### Major Changes

- 185d4fd: Preserve lazy pipeline metadata and defaults across supported Zod versions, and narrow the optional Zod peer contract to the tested ranges `>=3.24.0 <4` and `>=4.0.0 <5`.

### Patch Changes

- cb04752: Extract Zod v3/v4 enum values and object-valued generic metadata reliably through wrappers, pipelines, and recursive schema graphs.
- 54e8829: Fix inconsistent int check handling in Zod v3 extractor and address code review feedback
