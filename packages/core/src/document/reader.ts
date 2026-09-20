export function isReference(value: unknown): value is object {
	return (typeof value === "object" && value !== null) || typeof value === "function";
}

export function data(value: unknown, key: PropertyKey): unknown {
	if (!isReference(value)) return undefined;
	const descriptor = Object.getOwnPropertyDescriptor(value, key);
	return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

// Iteration avoids eagerly allocating a second array of all keys. Proxies can still run traps.
export function* entries(value: unknown): Generator<readonly [string, unknown]> {
	if (!isReference(value)) return;
	for (const key in value) {
		if (Object.hasOwn(value, key)) yield [key, data(value, key)];
	}
}

export function pointer(base: string, key: string | number): string {
	return `${base}/${String(key).replaceAll("~", "~0").replaceAll("/", "~1")}`;
}
