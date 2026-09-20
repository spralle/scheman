export function check(condition, message) {
	if (!condition) throw new Error(message);
}

export async function smoke(core) {
	const removed = [
		"ingestSchema",
		"extractFromJsonSchema",
		"extractFromZod",
		"extractFromZodV4",
		"registerExtractor",
		"findExtractor",
		"clearExtractorRegistry",
		"createValidationOnlyResult",
		"dereferenceSchema",
		"isJsonSchema",
		"isZodSchema",
		"isZodV4Schema",
		"flattenSchemaDocument",
		"JsonSession",
	];
	for (const name of removed) check(!(name in core), `Legacy/internal export: ${name}`);
	const source = { type: "object", properties: { next: { $ref: "#" } }, required: ["next"] };
	const { document } = core.ingestSchemaDocument(source, { provider: core.jsonSchemaProvider() });
	const root = document.nodes[document.root.input.nodeId];
	check(root.kind === "object", "Object graph root");
	const ref = document.nodes[root.properties[0].node.nodeId];
	check(ref.kind === "ref" && ref.target.nodeId === document.root.input.nodeId, "Recursive graph identity");
	check(root.properties[0].presence === "required", "Local presence");
	check(Object.isFrozen(root) && !Object.isFrozen(source), "Owned boundary");
	check(JSON.parse(JSON.stringify(document)).formatVersion === 1, "Serializable graph");
	let calls = 0;
	const standard = {
		"~standard": {
			version: 1,
			vendor: "smoke",
			async validate(value) {
				check(this === standard["~standard"], "Original validator receiver");
				calls++;
				return { value: String(value).length };
			},
		},
	};
	const result = core.ingestSchemaDocument(standard, { provider: core.standardSchemaProvider() });
	check(result.validator === standard && calls === 0 && !Object.isFrozen(standard), "Live unprobed validator");
	for (const side of ["input", "output"]) {
		check(result.document.capabilities[side] === "unavailable", "Unknown side capability");
		check(result.document.nodes[result.document.root[side].nodeId].kind === "unknown", "Unknown side node");
	}
	check((await result.validator["~standard"].validate("hello")).value === 5 && calls === 1, "Explicit validation");
	return { nodes: Object.keys(document.nodes).length, recursive: true, validator: true };
}
