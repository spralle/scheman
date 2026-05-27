# Scheman

Universal schema ingestion and metadata extraction.

<!-- badges -->

## What is Scheman?

Scheman is a universal schema ingestion library that normalizes JSON Schema, Zod v3, and Zod v4 into a common `SchemaIngestionResult` structure. It provides a pluggable extractor registry so you can add support for any StandardSchema-compatible validator.

## Installation

```bash
npm install @scheman/core
# or
pnpm add @scheman/core
# or
bun add @scheman/core
```

> **Note:** `zod` is an optional peer dependency — only needed if ingesting Zod schemas.

## Quick Start

**JSON Schema:**

```typescript
import { ingestSchema } from "@scheman/core";

const result = ingestSchema({
	type: "object",
	properties: {
		name: { type: "string", description: "User's full name" },
		age: { type: "integer", minimum: 0 },
		email: { type: "string", format: "email" },
	},
	required: ["name", "email"],
});

console.log(result.fields);
// [{ path: "name", type: "string", required: true, metadata: { description: "User's full name" } }, ...]
```

**Zod v3:**

```typescript
import { z } from "zod";
import { ingestSchema } from "@scheman/core";

const schema = z.object({
	name: z.string().describe("User's full name"),
	age: z.number().int().min(0).optional(),
	email: z.string().email(),
});

const result = ingestSchema(schema);
```

## Features

- JSON Schema ingestion with `$ref` dereferencing (local refs)
- Zod v3 and v4 schema extraction
- Pluggable extractor registry for any StandardSchema v1 vendor
- Schema middleware pipeline for transforming JSON Schemas before extraction
- Metadata merge with three-tier precedence (kernel defaults < embedded < external)
- Field type detection and normalization
- Zero runtime dependencies

## API Overview

| Function | Description |
|----------|-------------|
| `ingestSchema(schema)` | Main entry — auto-detects schema type and extracts fields |
| `registerExtractor(ext)` | Register a custom extractor for a StandardSchema vendor |
| `mergeMetadata(input)` | Merge metadata from multiple sources with precedence |
| `dereferenceSchema(schema)` | Resolve `$ref` in JSON Schema |
| `applySchemaMiddleware(schema, fns)` | Transform JSON Schema through middleware pipeline |

## Types

Key exported types:

- **`SchemaIngestionResult`** — The normalized output from `ingestSchema`
- **`SchemaFieldInfo`** — Describes a single field (path, type, required, metadata)
- **`SchemaFieldMetadata`** — Metadata attached to a field (description, default, examples, etc.)
- **`SchemaFieldType`** — Normalized field type union

## Custom Extractor

```typescript
import { registerExtractor } from "@scheman/core";

registerExtractor({
	vendor: "valibot",
	canExtract: (schema) => /* check if it's a valibot schema */,
	extract: (schema) => /* return SchemaFieldInfo[] */,
});
```

## Packages

| Package | Description |
|---------|-------------|
| [`@scheman/core`](./packages/core) | JSON Schema, Zod v3/v4 ingestion with pluggable extractors |

## Development

```bash
bun install
bun run build
bun run test
bun run lint
```

## License

MIT
