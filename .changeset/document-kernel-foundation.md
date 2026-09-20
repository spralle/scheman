---
"@scheman/core": major
---

Reserve the approved major release for the schema-document migration tracked by #33. This implementation checkpoint adds the internal bounded graph kernel, official Standard Schema type dependency, and document-specific error codes. Existing ingestion entry points and behavior have not yet been replaced.

This is a staged changeset, not the completed v2 release note. Complete the remaining providers, breaking public API replacement, migration documentation, and package/browser verification before merging or releasing this branch. Replace this checkpoint description with the final consumer-facing breaking-change notes during that integration. Do not manually bump the package version.
