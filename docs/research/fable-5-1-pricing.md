# Fable 5.1 pricing facts

Research for [issue #3](https://github.com/rbutera/chaching/issues/3). Researched 2026-09-10.

Scope: per-token rates for `claude-fable-5-1` and `claude-mythos-5-1`, what the `[1m]`
suffix in Claude Code transcripts means, how this differs from `claude-fable-5`, and the
`PriceEntry` rows chaching should encode.

## Confidence key

Every number below is tagged:

- **[LIVE]** — confirmed today against Anthropic's live docs/pricing pages (URL cited).
- **[SKILL]** — from the bundled `claude-api` skill's cached tables (cached 2026-06-24) or
  `shared/model-migration.md`. Corroborating, not authoritative.
- **[LOCAL]** — observed in this machine's own artifacts (Claude Code transcripts, repo source).
- **[UNKNOWN]** — not established by any source consulted.

## Sources consulted

| Source | URL |
| --- | --- |
| Anthropic pricing docs (primary; full cache columns) | <https://platform.claude.com/docs/en/docs/about-claude/pricing> (canonical: `https://platform.claude.com/docs/en/about-claude/pricing`) |
| Public pricing page | <https://claude.com/pricing> (`anthropic.com/pricing` 301s here) |
| Context windows doc | <https://platform.claude.com/docs/en/build-with-claude/context-windows> |
| Bundled `claude-api` skill, `shared/model-migration.md` + `shared/models.md` | skill cached 2026-06-24 |
| Local Claude Code transcripts | `~/.claude/projects/**/*.jsonl` |

Note: `docs.anthropic.com` and `www.anthropic.com` both permanently redirect to
`platform.claude.com` / `claude.com`. Cite the redirect targets.

## 1. Per-token rates

### claude-fable-5-1 — all five numbers **[LIVE]**

| Category | Per MTok | Per token | Source |
| --- | --- | --- | --- |
| Base input | $10.00 | `1e-5` | pricing docs model table **[LIVE]** |
| Output | $50.00 | `5e-5` | pricing docs model table **[LIVE]** |
| Cache write, 5m TTL | $12.50 | `1.25e-5` | pricing docs model table **[LIVE]** |
| Cache write, 1h TTL | $20.00 | `2e-5` | pricing docs model table **[LIVE]** |
| Cache read (hit/refresh) | **$0.25** | `2.5e-7` | pricing docs model table **[LIVE]** |

Batch API: $5 / $25 per MTok (50% discount) **[LIVE]**.

The cache-read figure is the one the issue asked to confirm, and it **is** confirmed —
twice, on two separate live pages:

> Cache hits and refreshes on Claude Fable 5.1 and Claude Mythos 5.1 are priced at 0.025x
> the base input price. All other models use the standard 0.1x multiplier.
> — <https://platform.claude.com/docs/en/about-claude/pricing>, footnote 1 on the model table

> | Cache read (hit) | 0.1x base input price (0.025x on Claude Fable 5.1 and Claude Mythos 5.1) |
> — same page, "Prompt caching" multiplier table

> On Claude Fable 5.1 and Claude Mythos 5.1, a cache hit costs 2.5% of the standard input
> price ($0.25 USD per million tokens).
> — same page, prose under the multiplier table

The public page at <https://claude.com/pricing> independently lists Fable 5.1 cache read at
$0.25 and Fable 5 cache read at $1.00 **[LIVE]**. It does not publish 1h cache-write
prices for any model — only the docs page does.

So the bundled skill's claim ($0.25 on 5.1 vs $1 on Fable 5) is **correct**.

### claude-mythos-5-1 — identical, including cache read **[LIVE]**

The docs pricing table gives Claude Mythos 5.1 its own row with the *same* five numbers as
Fable 5.1: $10 / $12.50 / $20 / $0.25 / $50, batch $5 / $25 **[LIVE]**. The 0.025x
cache-read footnote names Mythos 5.1 explicitly.

This **resolves an open question in the bundled skill**, which said "whether Claude
Mythos 5.1 shares the 0.025x rate is open at launch" (`shared/model-migration.md`) **[SKILL]**.
It does share it. Do not carry that caveat forward.

Mythos 5.1 is limited-availability (Project Glasswing) but is priced identically, so a
single shared constant is correct.

### Rate table, side by side

Per MTok. `[LIVE]` for every cell.

| Model | Input | Output | 5m write | 1h write | Cache read |
| --- | --- | --- | --- | --- | --- |
| Claude Fable 5.1 | $10 | $50 | $12.50 | $20 | **$0.25** |
| Claude Mythos 5.1 | $10 | $50 | $12.50 | $20 | **$0.25** |
| Claude Fable 5 | $10 | $50 | $12.50 | $20 | $1.00 |
| Claude Mythos 5 | $10 | $50 | $12.50 | $20 | $1.00 |
| Claude Opus 5 | $5 | $25 | $6.25 | $10 | $0.50 |

## 2. What `[1m]` means, and whether it changes the price

**Short answer: it is a Claude Code harness annotation for the 1M-context selection, not an
Anthropic model id, and it carries no pricing difference. `claude-fable-5-1[1m]` should be
priced exactly like `claude-fable-5-1`.**

Evidence:

1. **It is not an API model id.** It appears in no Anthropic model table or docs page. The
   bundled skill's migration guide classifies the family it belongs to:

   > | 4 | **Suffixed variant ID** | `claude-<model>-<suffix>` like `-fast`, `-1024k`,
   > `-200k`, `[1m]`, dated snapshots | These are deployment/routing identifiers, not the
   > public model ID.
   > — `shared/model-migration.md` **[SKILL]**

2. **Claude Code self-reports it as the model id with a 1M-context label.** The Claude Code
   system prompt in the session that produced this document says: *"You are powered by the
   model named Opus 5 (1M context). The exact model ID is `claude-opus-5[1m]`."* Same
   bracket notation, different base model — so the suffix denotes the context-window
   selection, not anything Fable-specific **[LOCAL]**.

3. **1M is the default on this model and needs no beta header, at standard pricing.**

   > For every model with a 1M-token context window, 1M is the default: you don't need a
   > beta header, and long-context requests are billed at standard pricing.
   > — <https://platform.claude.com/docs/en/build-with-claude/context-windows> **[LIVE]**

   > Claude 4.6 and later models and Claude Mythos Preview include the full 1M token
   > context window at standard pricing. (A 900k-token request is billed at the same
   > per-token rate as a 9k-token request.) Prompt caching and batch processing discounts
   > apply at standard rates across the full context window.
   > — <https://platform.claude.com/docs/en/about-claude/pricing>, "Long context pricing" **[LIVE]**

### Is there a long-context multiplier or threshold?

**No — not for Fable 5.1, Mythos 5.1, Fable 5, or any Claude 4.6-or-later model** **[LIVE]**.
There is no 200K threshold, no input multiplier, no output multiplier. The `PriceEntry`
fields `long_context_threshold_tokens` / `long_context_input_multiplier` /
`long_context_output_multiplier` must be left **unset** on these rows. (Those fields exist
in the repo for the GPT-5.6 family, which does have a 272K threshold — see
`gpt56()` in `overrides.ts`.)

The multipliers that *do* exist on Anthropic pricing and are **not** long-context are
**[LIVE]**: batch 0.5x; `inference_geo: "us"` 1.1x on all token categories (Claude 4.6+);
fast mode 2x, but fast mode is Opus 5 / Opus 4.8 only and does not apply to Fable. None of
these are inferable from a transcript model id, so chaching should not attempt to model them.

### `[1m]` in this machine's transcripts

Counting `"model":"..."` occurrences across `~/.claude/projects` **[LOCAL]**:

| model id | lines |
| --- | --- |
| `claude-opus-5` | 29,911 |
| `claude-opus-4-8` | 23,958 |
| `claude-fable-5-1` | 8,679 |
| `claude-fable-5` | 2,614 |
| `claude-sonnet-5` | 1,696 |
| **`claude-fable-5-1[1m]`** | **792** |

Both the plain and the `[1m]` form appear, in the same projects, from Claude Code
`2.1.263`. So the parser will see both and both must price.

## 3. What the repo does today, and how it differs

**[LOCAL]**, from reading the source.

`src/lib/core/pricing/overrides.ts` defines one `FABLE` constant used for both
`claude-fable-5` and `claude-mythos-5`:

```ts
const FABLE: PriceEntry = {
	input_cost_per_token: 1e-5,
	output_cost_per_token: 5e-5,
	cache_creation_input_token_cost: 1.25e-5,
	cache_creation_input_token_cost_above_1hr: 2e-5,
	cache_read_input_token_cost: 1e-6   // $1 / MTok
};
```

That row is **correct for Fable 5 / Mythos 5** — the live table still lists $1/MTok cache
reads for both **[LIVE]**. It is wrong for the 5.1 generation, where cache reads are
**a quarter of that**: `2.5e-7`, not `1e-6`.

Two further gaps, both worth flagging on the ticket even though this document changes no code:

1. **`claude-fable-5-1` resolves to `null` (unknown) on the server today.**
   `resolveUncached()` in `src/lib/core/pricing/cost.ts` tries, in order: exact override →
   exact snapshot key → provider-prefixed snapshot variants → a family fallback whose
   regexes are only `/opus/`, `/sonnet/`, `/haiku/`. There is no `claude-fable-5-1` override
   row; the vendored LiteLLM snapshot (`static/pricing/litellm-prices.json`) contains
   `claude-fable-5` and its regional variants but **no `fable-5-1` or `mythos-5-1` key at
   all**; and no family regex matches `fable`. So every one of the 9,471 local Fable 5.1
   lines (8,679 plain + 792 `[1m]`) prices as unknown rather than at any rate. That is the
   honest outcome under the repo's cost-honesty rule, but it is a coverage hole.

2. **The browser mirror disagrees with the server.**
   `src/lib/pricing-client.ts:115` is `if (/fable|mythos/i.test(model)) return FABLE;` — a
   family regex that *does* match `claude-fable-5-1` and `claude-fable-5-1[1m]`, and returns
   the **Fable 5** rates including the $1/MTok cache read. So the web UI currently displays
   Fable 5.1 at a 4x-too-high cache-read rate while the server reports unknown. Both sides
   need the 5.1 split, and the client regex needs a more-specific 5.1 branch *before* the
   generic `fable|mythos` branch.

3. **The `[1m]` suffix is never stripped.** `src/lib/core/ingest/parse.ts` takes
   `msg.model` verbatim (`const model = msg.model;`), and nothing in `src/` matches
   `[1m]`. So `claude-fable-5-1[1m]` reaches the resolver as a distinct key. Either add an
   exact override row for the bracketed id (simplest, matches the file's stated "exact-id
   overrides" contract) or normalise the suffix off before resolution. The former is
   recommended below because it keeps the resolver's exact-match contract intact and is
   what `overrides.ts` documents itself as being for.

## 4. Recommended `PriceEntry` rows

In the repo's shape (`src/lib/core/pricing/overrides.ts`). All five numbers **[LIVE]**;
the absence of long-context fields is also **[LIVE]** (explicitly "standard pricing", no
threshold).

```ts
// Fable/Mythos 5.1: same $10/$50 and same cache-write rates as Fable 5, but
// cache READS are 0.025x base input ($0.25/MTok) instead of the usual 0.1x —
// a quarter of the Fable 5 rate. Anthropic prices this per generation, so 5.1
// cannot share the FABLE constant.
// https://platform.claude.com/docs/en/about-claude/pricing (model table, note 1)
const FABLE_5_1: PriceEntry = {
	input_cost_per_token: 1e-5,
	output_cost_per_token: 5e-5,
	cache_creation_input_token_cost: 1.25e-5,
	cache_creation_input_token_cost_above_1hr: 2e-5,
	cache_read_input_token_cost: 2.5e-7
};
```

and in `PRICE_OVERRIDES`:

```ts
	'claude-fable-5-1': FABLE_5_1,
	// Claude Code writes the 1M-context selection into the model id as a
	// bracketed suffix. It is a harness/routing annotation, not an API model id,
	// and 1M carries no long-context premium on 4.6+ models — same rates.
	'claude-fable-5-1[1m]': FABLE_5_1,
	'claude-mythos-5-1': FABLE_5_1,
```

Leave the existing `'claude-fable-5': FABLE` and `'claude-mythos-5': FABLE` rows alone —
they are correct **[LIVE]**.

Defensively, `'claude-mythos-5-1[1m]'` and `'claude-fable-5[1m]'` would follow the same
pattern if those ids ever appear; neither is present in local transcripts today **[LOCAL]**,
so adding them is speculative and this document does not recommend it. A suffix-stripping
normalisation step in `resolveUncached()` would cover all of them at once and is the more
durable fix if the team prefers it — but it is a behaviour change to a shared resolver and
belongs in its own ticket.

The browser mirror in `src/lib/pricing-client.ts` needs the matching split, ordered
most-specific-first so the 5.1 ids don't fall into the generic `fable|mythos` branch:

```ts
const FABLE_5_1: ClientPrice = {
	input: 1e-5, output: 5e-5, cacheCreation: 1.25e-5, cacheRead: 2.5e-7
};
// ...before the generic /fable|mythos/ branch:
if (/(?:fable|mythos)-5-1/i.test(model)) return FABLE_5_1;
```

`client-safety.test.ts` guards the client/server split; keeping the two constants in sync is
the documented convention in `CLAUDE.md`.

## 5. Open / unknown

- **When the $0.25 rate took effect.** Whether it was Fable 5.1's launch price or a later
  cut is not stated on either page **[UNKNOWN]**. Immaterial to chaching, which prices by
  model id, not by date — but it does mean historical Fable 5.1 spend in `history.db` is
  frozen at whatever rate was resolved at freeze time (which today is *unknown*, i.e. it
  was never priced), so a backfill is not obviously safe.
- **Partner-platform rates.** Bedrock and Google Cloud are partner-operated with separate
  pricing **[LIVE]**; this document covers first-party API rates only, which is what Claude
  Code transcripts represent. Foundry and Claude Platform on AWS bill at standard first-party
  rates via CCUs **[LIVE]**.
- **Anything Anthropic changed after the fetch on 2026-09-10.** These pages are live and
  mutable; re-verify before shipping a price change.
