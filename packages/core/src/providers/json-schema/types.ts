import type { NodeRef, Side } from "../../document/types.js";
import type { DocumentContext } from "../types.js";

export type JsonSchemaDialect = "draft-07" | "draft-2020-12";
export interface JsonSchemaProviderOptions {
	readonly dialect?: JsonSchemaDialect;
}
export type JsonSchema = boolean | JsonSchemaObject;
export interface JsonSchemaObject {
	readonly [keyword: string]: unknown;
	readonly type?: string | readonly string[];
	readonly properties?: Readonly<Record<string, JsonSchema>>;
	readonly required?: readonly string[];
	readonly items?: JsonSchema | readonly JsonSchema[];
	readonly prefixItems?: readonly JsonSchema[];
	readonly additionalItems?: JsonSchema;
	readonly additionalProperties?: JsonSchema;
	readonly $defs?: Readonly<Record<string, JsonSchema>>;
	readonly definitions?: Readonly<Record<string, JsonSchema>>;
	readonly $ref?: string;
	readonly $schema?: string;
	readonly $id?: string;
	readonly $anchor?: string;
	readonly $dynamicRef?: string;
	readonly $dynamicAnchor?: string;
	readonly allOf?: readonly JsonSchema[];
	readonly anyOf?: readonly JsonSchema[];
	readonly oneOf?: readonly JsonSchema[];
	readonly if?: JsonSchema;
	readonly then?: JsonSchema;
	readonly else?: JsonSchema;
	readonly not?: JsonSchema;
	readonly contains?: JsonSchema;
	readonly propertyNames?: JsonSchema;
	readonly patternProperties?: Readonly<Record<string, JsonSchema>>;
	readonly dependentSchemas?: Readonly<Record<string, JsonSchema>>;
	readonly dependentRequired?: Readonly<Record<string, readonly string[]>>;
	readonly dependencies?: Readonly<Record<string, JsonSchema | readonly string[]>>;
	readonly const?: unknown;
	readonly enum?: readonly unknown[];
	readonly default?: unknown;
	readonly title?: string;
	readonly description?: string;
	readonly examples?: readonly unknown[];
	readonly readOnly?: boolean;
	readonly writeOnly?: boolean;
	readonly deprecated?: boolean;
	readonly minimum?: number;
	readonly maximum?: number;
	readonly exclusiveMinimum?: number;
	readonly exclusiveMaximum?: number;
	readonly multipleOf?: number;
	readonly minLength?: number;
	readonly maxLength?: number;
	readonly pattern?: string;
	readonly format?: string;
	readonly minItems?: number;
	readonly maxItems?: number;
	readonly minContains?: number;
	readonly maxContains?: number;
	readonly uniqueItems?: boolean;
	readonly minProperties?: number;
	readonly maxProperties?: number;
	readonly unevaluatedProperties?: JsonSchema;
	readonly unevaluatedItems?: JsonSchema;
}

export interface Location {
	readonly source: unknown;
	readonly pointer: string;
	readonly rebased: boolean;
}
export interface IndexedDefinition extends Location {
	readonly name: string;
}
export interface JsonReader {
	readonly context: DocumentContext;
	readonly side: Side;
	readonly dialect: JsonSchemaDialect;
	read(source: unknown, key: string | number, path: string): unknown;
	has(source: unknown, key: string): boolean;
	take(path: string): boolean;
	visit(source: unknown, path: string): NodeRef;
	unknown(path: string, reason: string): NodeRef;
	diagnose(code: string, path: string): void;
}
