import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
copyFileSync(resolve(root, "README.md"), resolve(root, "packages/core/README.md"));
copyFileSync(resolve(root, "docs/migration-v2.md"), resolve(root, "packages/core/MIGRATION.md"));
