import type { StandardSchemaV1 } from "@standard-schema/spec";
import { data } from "./document/reader.js";

export type { StandardSchemaV1, StandardJSONSchemaV1 } from "@standard-schema/spec";
export type StandardSchemaIssue = StandardSchemaV1.Issue;
export type StandardSchemaResult<Output = unknown> = StandardSchemaV1.Result<Output>;

export function isStandardSchema(value: unknown): value is StandardSchemaV1 {
	const standard = data(value, "~standard");
	return (
		data(standard, "version") === 1 &&
		typeof data(standard, "vendor") === "string" &&
		typeof data(standard, "validate") === "function"
	);
}
