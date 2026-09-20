import type { Availability, Diagnostic, Side } from "./types.js";

export class Diagnostics {
	readonly items: Diagnostic[] = [];
	readonly capabilities: Record<Side, Availability> = { input: "complete", output: "complete" };
	private omitted = false;
	constructor(private readonly maximum: number) {}

	add(code: string, side: Side, sourcePointer: string): void {
		this.capability(side, "partial");
		if (this.items.length < this.maximum - 1) {
			this.items.push(Object.freeze({ code, severity: "warning", side, sourcePointer }));
		} else if (!this.omitted) {
			this.omitted = true;
			this.items.push(Object.freeze({ code: "DIAGNOSTICS_TRUNCATED", severity: "warning", side, sourcePointer: "" }));
		}
	}

	capability(side: Side, availability: Availability): void {
		const rank = { complete: 0, partial: 1, unavailable: 2 };
		if (rank[availability] > rank[this.capabilities[side]]) this.capabilities[side] = availability;
	}
}
