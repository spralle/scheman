import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";

const roots = [
	"packages/core/src/document",
	"packages/core/src/providers",
	"packages/core/src/ingest-document.ts",
	"packages/core/src/standard.ts",
];

function files(path) {
	if (!statSync(path).isDirectory()) return [path];
	return readdirSync(path).flatMap((name) => files(join(path, name)));
}

function isFunction(node) {
	return (
		ts.isFunctionDeclaration(node) ||
		ts.isFunctionExpression(node) ||
		ts.isArrowFunction(node) ||
		ts.isMethodDeclaration(node) ||
		ts.isConstructorDeclaration(node) ||
		ts.isGetAccessor(node) ||
		ts.isSetAccessor(node)
	);
}

function isControl(node) {
	return (
		ts.isIfStatement(node) ||
		ts.isForStatement(node) ||
		ts.isForOfStatement(node) ||
		ts.isForInStatement(node) ||
		ts.isWhileStatement(node) ||
		ts.isDoStatement(node) ||
		ts.isSwitchStatement(node) ||
		ts.isTryStatement(node) ||
		ts.isConditionalExpression(node)
	);
}

function inspect(path) {
	const text = readFileSync(path, "utf8");
	const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
	const metrics = { path, lines: text.trimEnd().split("\n").length, functionLines: 0, nesting: 0 };
	function visit(node, depth = 0) {
		let currentDepth = depth;
		if (isFunction(node)) {
			const start = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
			const end = source.getLineAndCharacterOfPosition(node.getEnd()).line;
			metrics.functionLines = Math.max(metrics.functionLines, end - start + 1);
			currentDepth = 0;
		}
		if (isControl(node)) currentDepth++;
		metrics.nesting = Math.max(metrics.nesting, currentDepth);
		ts.forEachChild(node, (child) => visit(child, currentDepth));
	}
	visit(source);
	return metrics;
}

const metrics = roots
	.flatMap(files)
	.filter((path) => path.endsWith(".ts"))
	.map(inspect);
console.table(metrics);
const failures = metrics.filter((item) => item.lines > 400 || item.functionLines >= 50 || item.nesting > 3);
if (failures.length) {
	console.error("Document production code violates the #33 code-principles limits.");
	process.exitCode = 1;
}
