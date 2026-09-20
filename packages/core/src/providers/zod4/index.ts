import type { SchemaDocumentProvider } from "../types.js";
import { createZodProvider } from "../zod/shared.js";
import type { ZodProviderOptions } from "../zod/types.js";
import { zod4Reader } from "./reader.js";

export type { ZodProviderOptions } from "../zod/types.js";
export function zod4Provider(options: ZodProviderOptions = {}): SchemaDocumentProvider {
	return createZodProvider(zod4Reader, options);
}
