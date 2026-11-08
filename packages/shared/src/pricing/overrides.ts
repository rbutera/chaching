// Hand-maintained price overrides keyed by exact Claude Code / Codex model id.
//
// The vendored LiteLLM snapshot (static/pricing/litellm-prices.json) already
// carries every model id this machine produces today. This table is the
// safety net for ids LiteLLM lags on (new Opus point-releases ship in the
// harness before they land in the LiteLLM file). Anything here WINS over the
// snapshot, so keep it accurate.
//
// Prices are per single token in USD. Anthropic's published list rates
// (https://platform.claude.com/docs/en/about-claude/pricing, checked 2026-11-08):
// Fable 5 / Mythos 5 = $10/$50 per Mtok in/out, cache-write 5m = $12.50,
// cache-write 1h = $20, cache-read = $1 (Fable 5.1 / Mythos 5.1: read $0.25).
// Opus 4.6-5 = $5/$25, cache-write 5m = $6.25, cache-write 1h = $10, cache-read
// = $0.50. Opus 5.5 = $4/$20, cache-write $5/$8, read $0.20. Sonnet 4.6 =
// $3/$15, cache-write $3.75/$6, read $0.30. Sonnet 5 = $2/$10, cache-write
// $2.50/$4, read $0.20 (Sonnet 5.5: read $0.10). Haiku 4.5 = $1/$5,
// cache-write $1.25/$2, read $0.10. Haiku 5.5 = $0.10/$0.50, cache-write
// $0.125/$0.20, read $0.01 up to 100K prompt tokens, 5x every rate above.
//
// models.dev carries most of these too, but without the 1h cache-write rate, so
// usage with 1h cache writes (most Claude Code traffic) can only price here.

export interface PriceEntry {
	input_cost_per_token: number;
	output_cost_per_token: number;
	cache_creation_input_token_cost: number; // 5m / default cache-write rate
	cache_creation_input_token_cost_above_1hr?: number; // 1h cache-write rate
	cache_read_input_token_cost: number;
	long_context_threshold_tokens?: number;
	long_context_input_multiplier?: number;
	long_context_output_multiplier?: number;
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

const OPUS_5_5: PriceEntry = {
	input_cost_per_token: 4e-6,
	output_cost_per_token: 2e-5,
	cache_creation_input_token_cost: 5e-6,
	cache_creation_input_token_cost_above_1hr: 8e-6,
	cache_read_input_token_cost: 2e-7
};

const SONNET_5: PriceEntry = {
	input_cost_per_token: 2e-6,
	output_cost_per_token: 1e-5,
	cache_creation_input_token_cost: 2.5e-6,
	cache_creation_input_token_cost_above_1hr: 4e-6,
	cache_read_input_token_cost: 2e-7
};

const HAIKU_5_5: PriceEntry = {
	input_cost_per_token: 1e-7,
	output_cost_per_token: 5e-7,
	cache_creation_input_token_cost: 1.25e-7,
	cache_creation_input_token_cost_above_1hr: 2e-7,
	cache_read_input_token_cost: 1e-8,
	// "for prompts over 100,000 tokens": every rate is 5x.
	long_context_threshold_tokens: 100_000,
	long_context_input_multiplier: 5,
	long_context_output_multiplier: 5
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

function gpt56(
	input: number,
	output: number,
	cacheWrite: number,
	cacheRead: number
): PriceEntry {
	return {
		input_cost_per_token: input,
		output_cost_per_token: output,
		cache_creation_input_token_cost: cacheWrite,
		cache_read_input_token_cost: cacheRead,
		long_context_threshold_tokens: 272_000,
		long_context_input_multiplier: 2,
		long_context_output_multiplier: 1.5
	};
}

/** Exact-id overrides. Add a row here the moment a new model id appears unpriced. */
export const PRICE_OVERRIDES: Record<string, PriceEntry> = {
	'claude-fable-5-1': { ...FABLE, cache_read_input_token_cost: 2.5e-7 },
	'claude-mythos-5-1': { ...FABLE, cache_read_input_token_cost: 2.5e-7 },
	// OpenAI Standard tier (https://developers.openai.com/api/docs/pricing, checked
	// 2026-11-08): input, output, 30m cache write, cached input; over 272K input
	// tokens every input-side rate doubles and output is 1.5x.
	'gpt-6-astra': gpt56(1e-5, 5e-5, 1.25e-5, 1e-6),
	'gpt-6.1-sol': gpt56(2e-6, 1e-5, 2.5e-6, 1e-7),
	'gpt-6.1-terra': gpt56(1e-6, 5e-6, 1.25e-6, 5e-8),
	'gpt-6-sol': gpt56(2e-6, 1e-5, 2.5e-6, 2e-7),
	'gpt-6-luna': gpt56(1e-7, 5e-7, 1.25e-7, 1e-8),
	'gpt-5.6-sol': gpt56(4e-6, 2e-5, 5e-6, 4e-7),
	'gpt-5.6-terra': gpt56(2e-6, 1.2e-5, 2.5e-6, 2e-7),
	'gpt-5.6-luna': gpt56(2e-7, 1.2e-6, 2.5e-7, 2e-8),
	'claude-fable-5': FABLE,
	'claude-mythos-5': FABLE,
	'claude-opus-4-6': OPUS,
	'claude-opus-4-7': OPUS,
	'claude-opus-4-8': OPUS,
	'claude-opus-5-5': OPUS_5_5,
	'claude-opus-5': OPUS,
	'claude-sonnet-5-5': { ...SONNET_5, cache_read_input_token_cost: 1e-7 },
	'claude-sonnet-5': SONNET_5,
	'claude-sonnet-4-6': SONNET,
	'claude-haiku-5-5': HAIKU_5_5,
	'claude-haiku-4-5-20251001': HAIKU,
	'claude-haiku-4-5': HAIKU
};
