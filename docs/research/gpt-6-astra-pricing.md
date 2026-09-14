# GPT-6 Astra: pricing and model-family shape

Research for [issue #4](https://github.com/rbutera/chaching/issues/4). Researched 2026-09-10.

Short version: `gpt-6-astra` is the only GPT-6 id — no Sol/Terra/Luna-style tier trio. List rates are
$10 / $1 / $50 per Mtok (input / cached input / output), cache write $12.50, with the same
272K-token whole-request long-context surcharge that GPT-5.6 has (2x input and cache, 1.5x output).
LiteLLM already carries a row under the bare key `gpt-6-astra`, but the repo's snapshot refresh
pipeline drops the long-context fields, so the surcharge still has to live in `overrides.ts` — same
reason the `gpt56` helper exists.

## Rates

Per 1M tokens, standard service tier, from OpenAI's own pricing page and model page.

| | input | cached input | cache write | output |
|---|---|---|---|---|
| standard, <= 272K prompt | $10.00 | $1.00 | $12.50 | $50.00 |
| standard, > 272K prompt | $20.00 | $2.00 | $25.00 | $75.00 |
| batch | $5.00 | $0.50 | $6.25 | $25.00 |
| flex | $5.00 | $0.50 | $6.25 | $25.00 |
| fast (priority) | $20.00 | $2.00 | $25.00 | $100.00 |

Sources: <https://developers.openai.com/api/docs/pricing> (`platform.openai.com/docs/pricing` 301s
here), <https://developers.openai.com/api/docs/models/gpt-6-astra>.

Only the standard tier matters for chaching. Codex CLI usage bills at standard rates; there is no
service-tier field in the rollout JSONL to switch on, and batch/flex/fast are API-caller opt-ins.

**Long context.** The model page states it as a whole-request rule, not a marginal one: "Prompts
with more than 272K input tokens are priced at 2x input and cache rates and 1.5x output for the full
request" (<https://developers.openai.com/api/docs/models/gpt-6-astra>). Identical in shape to
GPT-5.6, which is why the existing `gpt56` helper's
`long_context_threshold_tokens: 272_000` / input x2 / output x1.5 transfers unchanged.

LiteLLM independently corroborates all of it — its row carries
`input_cost_per_token_above_272k_tokens: 2e-05` and `output_cost_per_token_above_272k_tokens: 7.5e-05`
against base `1e-05` / `5e-05`
(<https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json>).

Not directly relevant but noted so nobody re-derives them: EU/US regional data residency endpoints
add 10% (`regional_processing_uplift_multiplier_eu: 1.1` in the LiteLLM row; the OpenAI pricing page
describes the same uplift for models released on or after 2026-03-05), and fast mode is unavailable
with EU data residency.

## Tiered siblings: none

`gpt-6-astra` is the only GPT-6-branded model id in OpenAI's catalog. The catalog page lists the
GPT-6 group with exactly one entry, and lists no dated snapshot or `-latest` alias for it
(<https://developers.openai.com/api/docs/models>, <https://developers.openai.com/api/docs/models.md>).

The Sol / Terra / Luna trio is a GPT-5.6 thing and stays that way: the current catalog has
`gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna`, `gpt-5.6-cyber`, and the alias `gpt-5.6` -> `gpt-5.6-sol`.
OpenAI's own guidance positions the cheaper tiers as GPT-5.6 models sitting alongside Astra rather
than as GPT-6 variants: use Astra for hard work, Terra to balance intelligence and cost, Luna for
cost-sensitive high volume. The most recent mini/nano ids are GPT-5.4-generation
(`gpt-5.4-mini`, `gpt-5.4-nano`). No `gpt-6-astra-mini` / `-nano` / second GPT-6 tier exists as of
2026-09-10 — **unknown** whether one is planned; nothing in the docs says.

Other Astra facts worth having: context window 1,050,000, max output 128,000, knowledge cutoff
2026-04-30, reasoning effort low/medium/high/xhigh/max
(<https://developers.openai.com/api/docs/models/gpt-6-astra>).

Third-party hosting ids exist but chaching never sees them: `us.openai.gpt-6-astra` /
`global.openai.gpt-6-astra` (Bedrock), `azure/gpt-6-astra`, `openrouter/openai/gpt-6-astra`.

## The exact model id Codex CLI emits

The string is **`gpt-6-astra`**, verbatim, with no reasoning-effort or snapshot suffix.

Upstream, `codex-rs/models-manager/models.json` defines exactly one GPT-6 entry with
`"slug": "gpt-6-astra"` and `"display_name": "GPT-6-Astra"`; `gpt-6-astra` is the only GPT-6-shaped
string in the whole file (verified against `openai/codex` on GitHub). That slug is what lands in the
rollout JSONL.

Confirmed empirically against the local rollout logs (`~/.codex/sessions`, 2026-09):

```
$ grep -rho '"model":"[^"]*gpt-6[^"]*"' ~/.codex/sessions | sort | uniq -c
 818 "model":"gpt-6-astra"
```

818 occurrences, one distinct value. A structural walk of every JSON object in those lines shows
where the 818 sit:

| count | record type | JSON path |
|---|---|---|
| 171 | `turn_context` | `payload.model` |
| 171 | `turn_context` | `payload.collaboration_mode.settings.model` |
| 102 | `session_meta` | `payload.base_instructions.provenance.model` |
| 79 | `event_msg` (`thread_settings_applied`) | `payload.thread_settings.model` |
| 79 | `event_msg` (`thread_settings_applied`) | `payload.thread_settings.collaboration_mode.settings.model` |
| 72 | `world_state` | `payload.state.model`, `payload.state.collaboration_mode.model`, `payload.state.personality.model` |

Every value is the bare `gpt-6-astra`. Zero unparseable lines.

Two consequences for this repo:

1. `src/lib/core/providers/codex/parse.ts` already reads the right field — it latches
   `currentModel` from `turn_context` -> `payload.model` and attributes every subsequent
   `token_count` to it. No parser change is needed; the id flows through as-is.
2. This Codex version does **not** put a top-level `model` on `session_meta` (only nested under
   `base_instructions.provenance`). Anything that hoped to read the model from `session_meta`
   directly would come up empty — `turn_context` is the load-bearing record.

## LiteLLM status

Yes, LiteLLM has a row, under the **bare key `gpt-6-astra`** (`litellm_provider: "openai"`), so the
README's jq refresh — which filters on `test("claude|gpt-|codex|chatgpt|^o[0-9]|/o[0-9]")` — would
pick it up on the next run. Also present: `azure/gpt-6-astra`, `azure/us/gpt-6-astra`,
`azure_ai/gpt-6-astra`, `bedrock_mantle/openai.gpt-6-astra`, `us.openai.gpt-6-astra`,
`global.openai.gpt-6-astra`, `openrouter/openai/gpt-6-astra`
(<https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json>).

The `gpt-6-astra` row's relevant fields:

```json
"input_cost_per_token": 1e-05,
"output_cost_per_token": 5e-05,
"cache_creation_input_token_cost": 1.25e-05,
"cache_read_input_token_cost": 1e-06,
"input_cost_per_token_above_272k_tokens": 2e-05,
"output_cost_per_token_above_272k_tokens": 7.5e-05,
"cache_creation_input_token_cost_above_272k_tokens": 2.5e-05,
"cache_read_input_token_cost_above_272k_tokens": 2e-06,
"max_input_tokens": 922000,
"max_output_tokens": 128000
```

**But a snapshot refresh alone is not enough.** The jq pipeline in README's "Refresh the price map"
projects only five fields (`input_cost_per_token`, `output_cost_per_token`,
`cache_creation_input_token_cost`, `cache_creation_input_token_cost_above_1hr`,
`cache_read_input_token_cost`). Every `*_above_272k_tokens` field is discarded, so a refreshed
snapshot would price Astra correctly for normal prompts and silently **undercharge by 2x/1.5x** on
>272K-token requests. This is the same gap the README already acknowledges for GPT-5.6 ("the
upstream snapshot only carries base token rates"), and the same reason the fix belongs in
`overrides.ts`.

The vendored snapshot in this repo (`static/pricing/litellm-prices.json`, `snapshot_date`
2026-07-11, 677 price keys) has **no** `gpt-6` key at all. `static/pricing/modelsdev-prices.json`
likewise contains no `gpt-6` string.

## Current state in this repo: unpriced, not mispriced

Tracing `resolveUncached` in `src/lib/core/pricing/cost.ts` for `"gpt-6-astra"`:

1. not in `PRICE_OVERRIDES`;
2. not an exact key in the 2026-07-11 snapshot;
3. none of the normalised candidates (`anthropic.*`, `azure_ai/*`, `claude-*`) hit;
4. the family fallbacks only match `/opus|sonnet|haiku/`.

So it returns `null`. Cost honesty holds — the 818 local rows are flagged unknown rather than
counted as $0 — but they are invisible spend. At $10/$50 that is worth fixing before the next
receipt.

## Recommended override row

Astra's long-context rule is byte-for-byte the GPT-5.6 rule (272K threshold, 2x input, 1.5x output),
so the existing `gpt56` helper already produces the right `PriceEntry` shape. Reusing it verbatim
would leave a misleadingly-named call site, so rename the helper to something version-neutral (it
was never 5.6-specific — it encodes "OpenAI 272K whole-request long-context tier") and add:

```ts
// gpt-6-astra: $10 / $50 per Mtok, cache write $12.50, cache read $1.00.
// >272K prompt -> 2x input and cache rates, 1.5x output, for the FULL request.
// https://developers.openai.com/api/docs/models/gpt-6-astra
'gpt-6-astra': gpt56(1e-5, 5e-5, 1.25e-5, 1e-6),
```

which expands to:

```ts
{
  input_cost_per_token: 1e-5,
  output_cost_per_token: 5e-5,
  cache_creation_input_token_cost: 1.25e-5,
  cache_read_input_token_cost: 1e-6,
  long_context_threshold_tokens: 272_000,
  long_context_input_multiplier: 2,
  long_context_output_multiplier: 1.5
}
```

Note there is no `cache_creation_input_token_cost_above_1hr` — that field is Anthropic's 1h cache
tier and does not apply to OpenAI.

Two things that go with it:

- **Mirror it into `src/lib/pricing-client.ts`.** That file is a hand-maintained mirror with no Node
  imports, guarded by `client-safety.test.ts`. Today its `resolve` has
  `if (model.startsWith('gpt-5.6-')) return null;` right after the `GPT56` table, and nothing at all
  for `gpt-6`, so the browser bundle would fall through to the generic `/gpt-5/i`-family regexes —
  which do not match `gpt-6-astra` either, so the client also returns `null`. Add
  `'gpt-6-astra': { input: 1e-5, output: 5e-5, cacheCreation: 1.25e-5, cacheRead: 1e-6 }` and check
  it before those regexes. `ClientPrice` has no long-context fields, so the client mirror is
  base-rate only — consistent with how it already handles GPT-5.6.
- **Test coverage** alongside `codex.test.ts` lines 54-56, which currently parametrise
  `['gpt-5.6-sol', 0.1], ['gpt-5.6-terra', 0.05], ['gpt-5.6-luna', 0.02]`. That fixture is 20,000
  input tokens of which 10,000 cached, plus 1,000 output and 500 reasoning output — so 10,000
  billable input, 10,000 cache read, 1,500 output. For `gpt-6-astra` that is
  `10_000 x 1e-5 + 10_000 x 1e-6 + 1_500 x 5e-5 = 0.10 + 0.01 + 0.075 = 0.185`.

Codex's default context window for Astra is 272,000 (`models.json` `context_window: 272000`, with
`max_context_window: 872000`), so in practice Codex turns sit at or below the long-context
threshold and the multipliers rarely fire from this provider. Worth encoding anyway — the threshold
is a *prompt-size* rule and `costFromPriceEntry` already applies it from
`promptTokens = tokens.input + tokens.cacheRead`.

## Open / unconfirmed

- Whether OpenAI ships a cheaper GPT-6 tier (a "GPT-6 mini", or an Astra-generation Terra/Luna
  analogue) — **unknown**. Nothing in the docs announces one; the cheap tiers are still GPT-5.6.
- Whether a dated snapshot id (e.g. `gpt-6-astra-2026-09-03`) will appear later — **unknown**. None
  is published today, and none appears in local logs. If one lands, `overrides.ts` needs the exact
  id too; there is no prefix matching in `resolveUncached`.
- The docs' 1.05M context window vs Codex's `models.json` `max_context_window: 872000` and LiteLLM's
  `max_input_tokens: 922000` disagree. Immaterial to cost (the 272K threshold is what bills), but
  don't treat any one of them as the context number without rechecking.
- Astra's exact GA date: OpenAI's announcement page (`openai.com/index/gpt-6-astra/`) returned HTTP
  403 to automated fetch, so the rollout timeline is **unconfirmed** here. Secondary sources say
  2026-09-03 (Trusted Access) and AWS lists 2026-09-08; local logs first show the id on 2026-09-05.
  Not load-bearing for pricing.

## Sources

- OpenAI API pricing — <https://developers.openai.com/api/docs/pricing>
- OpenAI model catalog — <https://developers.openai.com/api/docs/models> and <https://developers.openai.com/api/docs/models.md>
- GPT-6 Astra model page — <https://developers.openai.com/api/docs/models/gpt-6-astra>
- LiteLLM price table — <https://github.com/BerriAI/litellm/blob/main/model_prices_and_context_window.json>
- Codex model registry — <https://github.com/openai/codex/blob/main/codex-rs/models-manager/models.json>
- Local rollout logs — `~/.codex/sessions/**/*.jsonl` (818 rows, 2026-09)
