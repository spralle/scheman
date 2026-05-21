/** Type guard for plain objects (not arrays, not null) */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Runtime type check matching JSON Schema type strings */
export function checkType(type: string, data: unknown): boolean {
  switch (type) {
    case "string":
      return typeof data === "string";
    case "number":
      return typeof data === "number";
    case "integer":
      return typeof data === "number" && Number.isInteger(data);
    case "boolean":
      return typeof data === "boolean";
    case "object":
      return isObject(data);
    case "array":
      return Array.isArray(data);
    case "null":
      return data === null;
    default:
      return true;
  }
}
