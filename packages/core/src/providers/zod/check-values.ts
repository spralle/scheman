const getTime = Date.prototype.getTime;
const regexSource = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get;
const flags = ["hasIndices", "global", "ignoreCase", "multiline", "dotAll", "unicode", "unicodeSets", "sticky"];
const flagReaders = flags.map((key) => Object.getOwnPropertyDescriptor(RegExp.prototype, key)?.get);
const flagNames = "dgimsuvy";

/** Intrinsic slot readers bypass user getters, overrides, toJSON and coercion hooks. */
export function checkValue(value: unknown): unknown {
	if (typeof value !== "object" || value === null) return value;
	try {
		const milliseconds = getTime.call(value);
		return { $type: "date", milliseconds: Number.isFinite(milliseconds) ? milliseconds : "NaN" };
	} catch {
		return regexValue(value);
	}
}
function regexValue(value: object): unknown {
	try {
		if (!regexSource) return value;
		const source = regexSource.call(value);
		const flags = flagReaders.map((reader, index) => (reader?.call(value) ? flagNames[index] : "")).join("");
		return { $type: "regexp", source, flags };
	} catch {
		return value;
	}
}
