/**
 * Casing helper(s) for the README casing contract. Personality banks are authored
 * lowercase; functional UI prose is sentence case at the source; structural tags
 * go through `caps()` → UPPERCASE. Consumers render verbatim.
 */

/** Structural-tag casing: UPPERCASE mono labels like `TOTAL BURN`, `BY MODEL`. */
export function caps(label: string): string {
	return label.toUpperCase();
}
