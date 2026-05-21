import { SchemaError } from "./errors.js";

export type MetadataSource = Readonly<Record<string, unknown>>;

export interface MergeInput {
  readonly kernelDefaults?: MetadataSource;
  readonly embedded?: MetadataSource;
  readonly external?: MetadataSource;
}

/**
 * Merge metadata from three precedence levels (lowest to highest):
 * kernelDefaults < embedded < external.
 * Higher precedence wins on conflict.
 */
export function mergeMetadata(input: MergeInput): Readonly<Record<string, unknown>> {
  let result: Record<string, unknown> = {};

  if (input.kernelDefaults) {
    result = deepMerge(result, input.kernelDefaults);
  }
  if (input.embedded) {
    result = deepMerge(result, input.embedded);
  }
  if (input.external) {
    result = deepMerge(result, input.external);
  }

  return result;
}

/**
 * Merge two sources at the same precedence level with strict conflict detection.
 * Structurally equal values are deduped; differing values throw SCHEMA_META_CONFLICT.
 */
export function mergeSamePrecedence(a: MetadataSource, b: MetadataSource): Readonly<Record<string, unknown>> {
  return deepMergeSamePrecedence(a, b);
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

/**
 * Cross-precedence merge: higher-precedence source wins.
 */
function deepMerge(lower: Record<string, unknown>, higher: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...lower };

  for (const key of Object.keys(higher)) {
    const hi = higher[key];

    if (hi === undefined) {
      continue;
    }

    if (hi === null || typeof hi !== "object" || Array.isArray(hi)) {
      result[key] = hi;
      continue;
    }

    const lo = result[key];
    if (isPlainObject(lo) && isPlainObject(hi)) {
      result[key] = deepMerge(lo as Record<string, unknown>, hi as Record<string, unknown>);
    } else {
      result[key] = hi;
    }
  }

  return result;
}

/**
 * Same-precedence merge with conflict detection.
 */
function deepMergeSamePrecedence(
  a: Readonly<Record<string, unknown>>,
  b: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...a };

  for (const key of Object.keys(b)) {
    const va = a[key];
    const vb = b[key];

    if (vb === undefined) {
      continue;
    }

    if (va === undefined) {
      result[key] = vb;
      continue;
    }

    if (structuralEqual(va, vb)) {
      result[key] = va;
      continue;
    }

    if (isPlainObject(va) && isPlainObject(vb)) {
      result[key] = deepMergeSamePrecedence(va as Record<string, unknown>, vb as Record<string, unknown>);
      continue;
    }

    throw new SchemaError(
      "SCHEMA_META_CONFLICT",
      `Metadata conflict at key "${key}": incompatible values at same precedence`,
    );
  }

  return result;
}

/** Deep structural equality for JSON-like values. */
export function structuralEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (typeof a !== typeof b) return false;

  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => structuralEqual(item, b[i]));
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = Object.keys(a);
    const keysB = Object.keys(b);
    if (keysA.length !== keysB.length) return false;
    return keysA.every((k) => Object.hasOwn(b, k) && structuralEqual(a[k], b[k]));
  }

  return false;
}
