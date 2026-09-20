# #33 integration audit map

This replaces the historical foundation checkpoint. Consumer semantics, budgets,
limitations and release notes are in [migration-v2.md](migration-v2.md); issue
[#33](https://github.com/spralle/scheman/issues/33) records gate outcomes and status.

- `src/document/`: owned graph, reserved IDs, bounded snapshots and safe copying.
- `src/providers/json-schema/`: dialects, reference index, structures/applicators.
- `src/providers/zod{,3,4}/`: distinct version readers and shared graph/policy code.
- `src/providers/standard-{schema,json-schema}.ts`: validation-only/conversion.
- `src/standard.ts`: official type-only spec dependency and passive inspection.
- `src/index.ts`: explicit public API; old adapters, registry, ingestion and stale
  Standard/field types are deleted. No flattening API or internal session export.
- `src/__tests__/`: graph/safety/limit/version matrix plus retained helper tests.
- `tests/package/`, `scripts/test-package.mjs`: actual artifact and browser gate.
- `scripts/check-document-principles.mjs`: all production source, not just kernel.

Audit maxEdges minimum 2 against the mandatory two-root-edge invariant, and
conservative budget accounting/partial diagnostics. Inspect custom providers as
trusted code, not a sandbox. No Formbar edits or release-workflow changes. CI adds
only principles and package/browser testing. #27 walker deletion is evidence for
Builder, not automatic issue closure. Engineer completion is not release approval;
Auditor verification and the existing reviewed Changesets/OIDC workflow follow.
