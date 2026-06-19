// Client-safe price resolver for the cost-math DISPLAY only (the authoritative
// cost is computed server-side and shipped in the snapshot). These mirror the
// override family rates so the detail sheet can show the per-class math without
// an extra round-trip. If a model is unknown, returns null and the UI says so.
//
// Per-token USD. Opus $5/$25, Sonnet $3/$15, Haiku $1/$5 (cache-write = 5m rate).

export interface ClientPrice {
	input: number;
	output: number;
	cacheCreation: number; // 5m / base cache-write rate
	cacheRead: number;
}

const OPUS: ClientPrice = { input: 5e-6, output: 2.5e-5, cacheCreation: 6.25e-6, cacheRead: 5e-7 };
const SONNET: ClientPrice = { input: 3e-6, output: 1.5e-5, cacheCreation: 3.75e-6, cacheRead: 3e-7 };
const HAIKU: ClientPrice = { input: 1e-6, output: 5e-6, cacheCreation: 1.25e-6, cacheRead: 1e-7 };

export function resolvePriceClient(model: string): ClientPrice | null {
	if (/opus/i.test(model)) return OPUS;
	if (/sonnet/i.test(model)) return SONNET;
	if (/haiku/i.test(model)) return HAIKU;
	return null;
}
