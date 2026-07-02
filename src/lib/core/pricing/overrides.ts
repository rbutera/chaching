// Hand-maintained price overrides keyed by EXACT Claude Code model id.
//
// The vendored LiteLLM snapshot (static/pricing/litellm-prices.json) already
// carries every model id this machine produces today. This table is the
// safety net for ids LiteLLM lags on (new Opus point-releases ship in the
// harness before they land in the LiteLLM file). Anything here WINS over the
// snapshot, so keep it accurate.
//
// Prices are per single token in USD. Anthropic's published list rates as of
// 2026-06: Fable 5 / Mythos 5 = $10/$50 per Mtok in/out, cache-write 5m =
// $12.50, cache-write 1h = $20, cache-read = $1. Opus = $5/$25, cache-write 5m
// = $6.25, cache-write 1h = $10, cache-read = $0.50. Sonnet = $3/$15,
// cache-write $3.75/$6, read $0.30. Haiku 4.5 = $1/$5, cache-write $1.25/$2,
// read $0.10.

export interface PriceEntry {
	input_cost_per_token: number;
	output_cost_per_token: number;
	cache_creation_input_token_cost: number; // 5m / default cache-write rate
	cache_creation_input_token_cost_above_1hr?: number; // 1h cache-write rate
	cache_read_input_token_cost: number;
}

const FABLE: PriceEntry = {
	input_cost_per_token: 1e-5,
	output_cost_per_token: 5e-5,
	cache_creation_input_token_cost: 1.25e-5,
	cache_creation_input_token_cost_above_1hr: 2e-5,
	cache_read_input_token_cost: 1e-6
};

const OPUS: PriceEntry = {
	input_cost_per_token: 5e-6,
	output_cost_per_token: 2.5e-5,
	cache_creation_input_token_cost: 6.25e-6,
	cache_creation_input_token_cost_above_1hr: 1e-5,
	cache_read_input_token_cost: 5e-7
};

const SONNET: PriceEntry = {
	input_cost_per_token: 3e-6,
	output_cost_per_token: 1.5e-5,
	cache_creation_input_token_cost: 3.75e-6,
	cache_creation_input_token_cost_above_1hr: 6e-6,
	cache_read_input_token_cost: 3e-7
};

const HAIKU: PriceEntry = {
	input_cost_per_token: 1e-6,
	output_cost_per_token: 5e-6,
	cache_creation_input_token_cost: 1.25e-6,
	cache_creation_input_token_cost_above_1hr: 2e-6,
	cache_read_input_token_cost: 1e-7
};

/** Exact-id overrides. Add a row here the moment a new model id appears unpriced. */
export const PRICE_OVERRIDES: Record<string, PriceEntry> = {
	'claude-fable-5': FABLE,
	'claude-mythos-5': FABLE,
	'claude-opus-4-6': OPUS,
	'claude-opus-4-7': OPUS,
	'claude-opus-4-8': OPUS,
	'claude-sonnet-4-6': SONNET,
	'claude-haiku-4-5-20251001': HAIKU,
	'claude-haiku-4-5': HAIKU
};
