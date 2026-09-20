import type { SchemaDocumentProvider } from "../types.js";
import { createZodProvider } from "../zod/shared.js";
import type { ZodProviderOptions } from "../zod/types.js";
import { zod3Reader } from "./reader.js";

export type { ZodProviderOptions } from "../zod/types.js";
export function zod3Provider(options: ZodProviderOptions = {}): SchemaDocumentProvider {
	return createZodProvider(zod3Reader, options);
}
