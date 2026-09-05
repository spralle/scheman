# @scheman/core

## 1.0.0

### Major Changes

- 185d4fd: Preserve lazy pipeline metadata and defaults across supported Zod versions, and narrow the optional Zod peer contract to the tested ranges `>=3.24.0 <4` and `>=4.0.0 <5`.

### Patch Changes

- cb04752: Extract Zod v3/v4 enum values and object-valued generic metadata reliably through wrappers, pipelines, and recursive schema graphs.
- 54e8829: Fix inconsistent int check handling in Zod v3 extractor and address code review feedback
