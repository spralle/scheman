import { defineConfig } from "tsup";

export const baseConfig = defineConfig({
	format: ["esm", "cjs"],
	dts: {
		compilerOptions: {
			composite: false,
			exactOptionalPropertyTypes: false,
		},
	},
	clean: true,
	splitting: false,
	sourcemap: true,
	treeshake: true,
	outDir: "dist",
});
