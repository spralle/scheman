import type { NodeRef, OwnedValue } from "./types.js";

export type Primitive =
	| "string"
	| "number"
	| "integer"
	| "boolean"
	| "null"
	| "undefined"
	| "void"
	| "bigint"
	| "symbol"
	| "date"
	| "NaN";
export interface PropertyEdge {
	readonly name: string;
	readonly presence: "required" | "optional" | "unknown";
	readonly node: NodeRef;
}
export interface Applicators {
	readonly if?: NodeRef;
	readonly then?: NodeRef;
	readonly else?: NodeRef;
	readonly not?: NodeRef;
	readonly contains?: NodeRef;
	readonly propertyNames?: NodeRef;
	readonly patternProperties?: Readonly<Record<string, NodeRef>>;
	readonly dependentSchemas?: Readonly<Record<string, NodeRef>>;
}
interface Common {
	readonly metadata?: OwnedValue;
	readonly constraints?: OwnedValue;
	readonly applicators?: Applicators;
}
export type SchemaNode = Common &
	(
		| { readonly kind: "unknown" | "opaque"; readonly reason: string }
		| { readonly kind: "unconstrained"; readonly domain: "json" | "js" }
		| { readonly kind: "never" }
		| { readonly kind: "primitive"; readonly type: Primitive }
		| { readonly kind: "literal"; readonly value: OwnedValue }
		| { readonly kind: "enum"; readonly values: readonly OwnedValue[] }
		| {
				readonly kind: "object";
				readonly properties: readonly PropertyEdge[];
				readonly required: readonly string[];
				readonly additionalProperties?: NodeRef;
				readonly unknownKeys: "strip" | "reject" | "passthrough" | "schema" | "unknown";
		  }
		| { readonly kind: "array"; readonly items: NodeRef }
		| { readonly kind: "tuple"; readonly items: readonly NodeRef[]; readonly rest?: NodeRef }
		| {
				readonly kind: "record";
				readonly key: NodeRef;
				readonly value: NodeRef;
				readonly exhaustive: boolean | "unknown";
		  }
		| {
				readonly kind: "union";
				readonly alternatives: readonly NodeRef[];
				readonly semantics: "anyOf" | "oneOf" | "zod";
				readonly discriminator?: OwnedValue;
		  }
		| { readonly kind: "intersection"; readonly operands: readonly NodeRef[] }
		| { readonly kind: "ref"; readonly reference: string; readonly target?: NodeRef; readonly unresolved?: string }
		| {
				readonly kind: "wrapper";
				readonly wrapper:
					| "optional"
					| "nullable"
					| "default"
					| "catch"
					| "readonly"
					| "brand"
					| "pipeline"
					| "effect"
					| "coerce";
				readonly inner: NodeRef;
				readonly value?: OwnedValue;
		  }
	);
