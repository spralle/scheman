import { data } from "../../document/reader.js";
import type { NodeRef, Side } from "../../document/types.js";
import type { DocumentContext, SchemaDocumentProvider } from "../types.js";
import { dialectOption, selectDialect } from "./dialect.js";
import { JsonBudget } from "./reader.js";
import { ReferenceIndex } from "./references.js";
import type { JsonSchemaDialect, JsonSchemaProviderOptions } from "./types.js";
import { JsonWalk } from "./walker.js";

export type { JsonSchema, JsonSchemaObject, JsonSchemaDialect, JsonSchemaProviderOptions } from "./types.js";

export function jsonSchemaProvider(options: JsonSchemaProviderOptions = {}): SchemaDocumentProvider {
	const explicit = dialectOption(options);
	return {
		name: "json-schema",
		build(schema, context) {
			const dialect = selectDialect(schema, explicit);
			context.metadata({
				provider: "json-schema",
				dialect,
				dialectSource: explicit ? "option" : data(schema, "$schema") === undefined ? "default" : "$schema",
			});
			const session = new JsonSession(context);
			return session.both(schema, dialect);
		},
	};
}

/** Internal composition entry for independently converted Standard JSON sides. */
export class JsonSession {
	private readonly budget: JsonBudget;
	private definitions = 0;
	constructor(private readonly context: DocumentContext) {
		this.budget = new JsonBudget(context);
	}

	both(schema: unknown, dialect: JsonSchemaDialect): Record<Side, NodeRef> {
		const index = this.index(schema, dialect, ["input", "output"]);
		return { input: this.walk(schema, "input", dialect, index), output: this.walk(schema, "output", dialect, index) };
	}

	side(schema: unknown, side: Side, dialect: JsonSchemaDialect): NodeRef {
		return this.walk(schema, side, dialect, this.index(schema, dialect, [side]));
	}

	private index(schema: unknown, dialect: JsonSchemaDialect, sides: readonly Side[]): ReferenceIndex {
		const index = new ReferenceIndex(schema, dialect, this.context, this.budget, sides);
		index.build();
		return index;
	}

	private walk(schema: unknown, side: Side, dialect: JsonSchemaDialect, index: ReferenceIndex): NodeRef {
		const walker = new JsonWalk(this.context, side, dialect, index, this.budget);
		const root = walker.visit(schema, "");
		for (const entry of index.definitions) {
			if (this.definitions >= this.context.limits.maxDefinitions || !walker.take(entry.pointer)) {
				walker.diagnose("JSON_DEFINITION_LIMIT", entry.pointer);
				break;
			}
			this.definitions++;
			this.context.definition(side, entry.pointer, walker.visit(entry.source, entry.pointer), entry.name);
		}
		return root;
	}
}
