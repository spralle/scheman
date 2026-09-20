import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { build } from "esbuild";
import { chromium } from "playwright";

const root = resolve(import.meta.dirname, "..");
const temporary = mkdtempSync(join(tmpdir(), "scheman-package-"));
const run = (command, args, cwd = temporary) => execFileSync(command, args, { cwd, stdio: "inherit" });
try {
	const packed = JSON.parse(
		execFileSync("npm", ["pack", "--json", "--pack-destination", temporary], {
			cwd: join(root, "packages/core"),
			encoding: "utf8",
		}),
	)[0];
	assert(
		packed.files.some((file) => file.path === "MIGRATION.md"),
		"Packed migration notes",
	);
	writeFileSync(join(temporary, "package.json"), JSON.stringify({ private: true, type: "module" }));
	run("npm", [
		"install",
		"--ignore-scripts",
		"--no-audit",
		"--no-fund",
		"--legacy-peer-deps",
		join(temporary, packed.filename),
	]);
	assert(!existsSync(join(temporary, "node_modules/zod")), "Optional Zod must be absent initially");
	cpSync(join(root, "tests/package"), temporary, { recursive: true });
	const spec = join(temporary, "node_modules/@standard-schema/spec");
	renameSync(spec, `${spec}-hidden`);
	writeFileSync(
		join(temporary, "esm.mjs"),
		'import * as core from "@scheman/core"; import { smoke } from "./smoke.mjs"; console.log("PASS ESM without Zod/spec runtime", await smoke(core));',
	);
	writeFileSync(
		join(temporary, "cjs.cjs"),
		'const core = require("@scheman/core"); import("./smoke.mjs").then(({smoke}) => smoke(core)).then(result => console.log("PASS CJS without Zod/spec runtime", result));',
	);
	run("node", ["esm.mjs"]);
	run("node", ["cjs.cjs"]);
	renameSync(`${spec}-hidden`, spec);
	const tsc = join(root, "node_modules/typescript/bin/tsc");
	for (const extension of ["mts", "cts", "ts"]) {
		const file = `consumer.${extension}`;
		if (extension !== "ts") cpSync(join(temporary, "consumer.ts"), join(temporary, file));
		const bundler = extension === "ts";
		run("node", [
			tsc,
			"--noEmit",
			"--strict",
			"--exactOptionalPropertyTypes",
			"--target",
			"ES2022",
			"--module",
			bundler ? "ESNext" : "NodeNext",
			"--moduleResolution",
			bundler ? "bundler" : "NodeNext",
			file,
		]);
		console.log(`PASS declarations ${extension}`);
	}
	writeFileSync(
		join(temporary, "browser.mjs"),
		'import * as core from "@scheman/core"; import { smoke } from "./smoke.mjs"; globalThis.packageSmoke = () => smoke(core);',
	);
	const bundle = await build({
		entryPoints: [join(temporary, "browser.mjs")],
		bundle: true,
		platform: "browser",
		format: "iife",
		write: false,
		metafile: true,
	});
	assert(
		Object.keys(bundle.metafile.inputs).every(
			(path) => !path.includes("@standard-schema") && !/node_modules\/zod\//.test(path),
		),
		"No runtime vendor imports",
	);
	const executablePath =
		process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ??
		(!existsSync(chromium.executablePath()) && existsSync("/usr/bin/chromium") ? "/usr/bin/chromium" : undefined);
	const browser = await chromium.launch({ headless: true, ...(executablePath ? { executablePath } : {}) });
	try {
		const page = await browser.newPage();
		await page.addScriptTag({ content: bundle.outputFiles[0].text });
		const result = await page.evaluate(async () => {
			if (typeof process !== "undefined" || typeof Buffer !== "undefined") throw new Error("Node globals in browser");
			return globalThis.packageSmoke();
		});
		console.log(`PASS Chromium ${browser.version()} (${executablePath ?? "Playwright managed"})`, result);
	} finally {
		await browser.close();
	}
	for (const version of ["3.24.0", "3.25.76", "4.0.0", "4.1.5"]) {
		run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund", `zod@${version}`]);
		run("node", ["zod.mjs", version]);
	}
	for (const name of ["README.md", "MIGRATION.md"]) {
		const text = readFileSync(join(temporary, "node_modules/@scheman/core", name), "utf8");
		let index = 0;
		for (const match of text.matchAll(/```ts\n([\s\S]*?)```/g)) {
			const file = `example-${name}-${index++}.mts`;
			writeFileSync(join(temporary, file), match[1]);
			run("node", [
				tsc,
				"--noEmit",
				"--strict",
				"--target",
				"ES2022",
				"--module",
				"NodeNext",
				"--moduleResolution",
				"NodeNext",
				file,
			]);
		}
		console.log(`PASS ${name}: ${index} compiled examples`);
	}
	console.log(`PASS packed artifact ${packed.filename}: ESM/CJS, NodeNext/bundler, optional peers, browser graph`);
} finally {
	rmSync(temporary, { recursive: true, force: true });
}
