# Automatic pricing refresh and correction contract

Research and implementation recommendations, 11 September 2026. Planning only. Local source inspected at `6221826`; no runtime or historical data changed. Public catalog facts below describe schemas, not a claim that every model row is complete or that a current price was historically effective.

## Approved decisions

The [Price resolver hardening spec](https://github.com/rbutera/chaching/issues/5) records Rai's approval of:

- Exact known-model prices before a consistent family estimate; unfamiliar families remain unknown.
- Automatic daily refresh of existing public catalogs while chaching runs; earlier refresh on an unpriced model, a validated last-good local cache and bundled offline fallback.
- Browser and server use the same effective pricing data and lookup policy.
- When exact pricing becomes available, repair recorded missing/family-estimated costs upwards or downwards; preserve costs already calculated using known exact rates.
- Preserve token/request usage and enough billing evidence for corrections after source pruning. Do not guess legacy records into exact historical cost, reprice every historical exact record at today's rates, or change upward-only Tokenmaxx token reconciliation.

The issue identifies exact misses hidden by family fallback, coalescing/cooldown, nonblocking ingestion and preserving billing dimensions as implementation interpretations. They are sensible defaults, not additional product decisions already approved verbatim.

## Public catalog findings

These are maintained third-party catalogs, not first-party model-vendor pricing APIs. Models.dev documents its [public API and per-million units](https://github.com/anomalyco/models.dev/blob/b8244af8bd1ca8c0e60103f058854d5510a2534d/README.md); LiteLLM publishes its [price registry](https://github.com/BerriAI/litellm/blob/033f2e5e2a651fed59faf6478fb18314e487738b/model_prices_and_context_window.json). Their existence does not establish whether any particular vendor offers a pricing API.

| Dimension | Models.dev | LiteLLM |
|---|---|---|
| Base rates | `cost.input`, `cost.output` per million | `input_cost_per_token`, `output_cost_per_token` per token |
| Cache | `cache_read`, `cache_write`; no separate TTL rates in the inspected schema | `cache_read_input_token_cost`, `cache_creation_input_token_cost`, `cache_creation_input_token_cost_above_1hr` |
| Context | `cost.tiers[]` with `tier.type = context`, `tier.size` and rates | `tiered_pricing[]` range/rate tables and explicit rate fields suffixed `_above_128k_tokens`, `_above_200k_tokens`, `_above_256k_tokens`, `_above_272k_tokens`, `_above_512k_tokens`; row availability varies |
| Provider | Provider record identity with nested model IDs | Model key plus `litellm_provider`; qualified/region keys exist |
| Dates | `release_date`, `last_updated`, provider `doc` | Some rows have `source`; deprecation dates are not pricing dates |

Sources: [Models.dev schema](https://github.com/anomalyco/models.dev/blob/b8244af8bd1ca8c0e60103f058854d5510a2534d/packages/core/src/schema.ts), [LiteLLM registry](https://github.com/BerriAI/litellm/blob/033f2e5e2a651fed59faf6478fb18314e487738b/model_prices_and_context_window.json).

Models.dev's legacy `context_over_200k` compatibility field can be generated from a tier whose actual boundary is higher than 200k. Consume the explicit tier list and its sizes, not the compatibility field's name. [Generator](https://github.com/anomalyco/models.dev/blob/b8244af8bd1ca8c0e60103f058854d5510a2534d/packages/core/src/generate.ts)

LiteLLM also carries combined context/TTL fields such as `cache_creation_input_token_cost_above_1hr_above_200k_tokens`. Its calculation separates ephemeral 5m and 1h cache tokens. Context prices are explicit rates; there is no universal cross-model multiplier. The registry also contains `tiered_pricing` arrays with `range` boundaries, and the runtime has provider-specific inclusive-threshold handling. Preserve boundary semantics instead of translating every catalog to one hardcoded strict-above threshold. [Calculation implementation](https://github.com/BerriAI/litellm/blob/033f2e5e2a651fed59faf6478fb18314e487738b/litellm/litellm_core_utils/llm_cost_calc/utils.py)

Neither inspected schema provides a uniform historical price-effective date. Retain observed fetch time and content revision separately. Direct retrieval of the models.dev API returned HTTP 403 in the research environment; its endpoint and schema were verified against its maintained repository, not a successful API payload fetch.

## Local constraints

| Evidence | Consequence |
|---|---|
| `src/lib/core/pricing/cost.ts:79–89`, `modelsdev.ts:145–157`: process-global lookup maps cache exact, fallback and null results indefinitely. | An installed catalog revision must replace/invalidate both resolver caches, including negative and estimated hits. Replacing a file alone cannot affect existing processes. |
| `pricing-client.ts:108`: independent browser regex/table; `pricing-parity.test.ts:34`: tests compare table entries, not actual server lookup. | Use one pure provider-aware resolver and normalized catalog shape. Keep fetch/filesystem adapters server-only. Test actual server/browser resolution including aliases, exact-miss estimates and negatives. |
| `modelsdev.ts:162–174`, `scripts/gen-modelsdev-prices.ts:73–81`: only basic input/output/read/write conversion; no TTL or threshold fields survive. | Refresh must normalize supported billing dimensions instead of retaining the old lossy projection. |
| `history/store.ts:65–105`: per-day/model sums and whole-session summaries, with no lookup provenance. `types.ts:12–33`: no stored provider pricing identity or prompt-length evidence. | Missing, estimated and exact costs cannot currently be separated reliably after pruning. A schema change is necessary for the approved repair rule. |
| `rollup/rollup.ts:199–207`: frozen days are skipped during normal scans. | A catalog refresh cannot repair history by merely rescanning through ordinary ingestion. |
| `history/store.ts:263–279`: Tokenmaxx backfill takes `MAX` of costs and unknown counts. | Do not reuse this path for pricing correction. Downward repairs and clearing unknown counts need their own transactional replacement/delta path. |
| `sync/store.ts:489–502`: pooled day rows are full replacement upserts, including cost and unknown counts. | PostgreSQL already permits lower costs. Republish affected complete day/session/hour aggregates; preserve source ownership and invalidate/render deltas. Do not redesign this as a second additive correction publisher. |
| `pricing-client.ts:1–5` and browser cache breakdown: current rates explain stored cost. | Sharing a refreshed catalog does not by itself preserve historical display accuracy when exact old valuations are immutable. Historical breakdowns need their original monetary components/rate evidence. |

## Proposed implementation defaults

### One valuation pipeline

Keep source fetching and disk storage out of the browser. Normalize catalogs into a client-safe provider/model/billing-context table consumed by one pure resolver. The current single-threshold `PriceEntry` shape must accommodate the supported source tier tables rather than flattening them to base rates. Preserve the original usage model label separately from its normalized pricing key. A recognized terminal `[1m]` annotation can normalize to the underlying model without inventing a pricing multiplier; unknown suffixes are not blanket-stripped.

Resolution should return its provenance together with the rate: exact/estimated/missing, selected model/provider, catalog revision and selected billing dimensions. Preserve existing exact corrective overrides ahead of catalog entries, then provider-specific refreshed exact entries, bundled exact entries and documented family representatives. A cross-provider match must not be labelled an exact quote for a different billing provider. Retain actual provider-reported charges independently; catalog list-price discovery does not authorize rewriting those charges.

A successful validated refresh atomically installs an immutable revision and invalidates all lookup caches. Notify browser clients of that effective revision through the existing snapshot/delta path; publish only normalized pricing data, never filesystem paths or user Account data. Frozen exact historical values render from their recorded monetary breakdown or rate buckets, rather than applying today's rate to old token totals.

### Fetch/cache lifecycle

Use the existing public models.dev and LiteLLM sources. Proposed defaults: check freshness on engine startup, refresh once after 24 hours since the last successful check, and coalesce exact misses into one in-flight refresh even when a family estimate is available. Ingestion continues immediately using last-good/bundled/estimated/unknown results. Apply a bounded miss retry cooldown so a genuinely absent model cannot fetch once per record. Short-lived CLI runs should share the disk cache and freshness metadata; do not create a permanent daemon just for pricing.

Validate source structure, provider/model identity, finite nonnegative rates, currency/unit conversion and supported threshold/TTL fields before promotion. Do not convert absent billed dimensions into a confident zero. Preserve genuinely explicit zero prices. Invalid/failed payloads keep the previous source revision. Use bounded response size and timeout. Multiple local processes may fetch simultaneously; atomic replacement and a consistent revision guard must prevent an older response replacing a newer accepted cache. No model/usage/Account data is sent to catalog hosts.

Store source URL, fetch/check time, payload hash and normalization schema version; preserve upstream revision/ETag/Last-Modified when actually available. A fetch date, model release date or knowledge cutoff is not a historical price-effective date. No promise of a native model-vendor pricing API is required.

### Correct only eligible evidence

At ingestion, retain content-free billing evidence for missing/estimated valuations: stable event key, source/machine, harness and billing provider, model/pricing key, day and session, token classes, cache TTL split, prompt count used for threshold selection, relevant tool counters and billing tier when available, previous cost and provenance/revision. Keep it in the history transaction alongside the aggregate it affected. A daily token sum, or a bucket selected using an old threshold, cannot support an arbitrary newly discovered per-request threshold.

Exact historical costs remain protected. For an eligible record with sufficient evidence and a newly exact rate, calculate the replacement using the shared cost function. In one transaction, mark it exact and apply `newCost - oldCost` to every affected retained aggregate and monetary breakdown, updating unknown counts only when an unknown becomes known. Make retries idempotent by eligibility/revision, not by adding the delta twice. Publish complete affected aggregate rows after committing. Pool peers continue to consume the owner's resulting valuations rather than independently repairing the same usage again.

Legacy records without provenance or billing evidence stay as recorded/unresolved. Surviving source records may support recovery only when they establish the original eligible contribution and stable identity; never infer that all known costs were family estimates. History-disabled operation can repair only evidence still available in the current process or source files.

## Acceptance cases

A new member of a known family triggers exact discovery despite an immediate family estimate. A failed/invalid fetch preserves last-good rates and does not stall ingestion. A concurrent miss burst produces one request; a persistent miss observes cooldown. Accepted catalog revisions invalidate previous null/family hits.

A cache-heavy family estimate may decrease on exact discovery. The corrected total, historical cache breakdown, receipt, Wrapped and pooled snapshot agree. Repeating the repair changes nothing. Already-exact cost remains byte-for-byte numerically unchanged. Prompt totals at and above a supported threshold use the right full-request rates; 5m and 1h cache writes stay distinct. Legacy aggregates missing threshold evidence are not advertised as exact repairs.

## Human decisions still needed

None of the above engineering defaults requires another preference round to proceed with a spec. Source precedence and unsupported billing dimensions should be explicit acceptance criteria, not silently guessed rates. If catalogs disagree for the same provider/model/billing context beyond an existing documented override, surface that factual conflict rather than asking the user to choose between raw source names in the abstract.
