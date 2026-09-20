import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// The production version belongs to Changesets. Only the disposable copy is changed.
const source = resolve(import.meta.dirname, "../packages/core");
const staging = mkdtempSync(join(tmpdir(), "scheman-release-preview-"));
try {
	for (const name of ["dist", "src", "README.md", "MIGRATION.md", "package.json"]) {
		cpSync(join(source, name), join(staging, name), { recursive: true });
	}
	const path = join(staging, "package.json");
	const manifest = JSON.parse(readFileSync(path, "utf8"));
	manifest.version = "2.0.0";
	writeFileSync(path, `${JSON.stringify(manifest, null, 2)}\n`);
	execFileSync("npm", ["publish", "--dry-run", "--access", "public"], { cwd: staging, stdio: "inherit" });
	console.log("PASS disposable 2.0.0 release preview; production manifest unchanged");
} finally {
	rmSync(staging, { recursive: true, force: true });
}
