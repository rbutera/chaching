# Automatic pricing and historical estimate correction

Implementation specification for [Price resolver hardening](https://github.com/rbutera/chaching/issues/5), following the approved daily refresh, exact-miss refresh and historical correction decisions. Source checked against main `277a950` on 11 September 2026. This document changes no runtime behavior.

## Outcome

New models using supported billing rules acquire prices without a chaching release. Refresh the existing public catalogs daily and sooner when an observed model lacks an exact price, even when a family estimate exists. Browser and server resolve the same provider/model against the same catalog revision. Keep working offline with the last validated catalog and bundled data.

When an exact rate arrives, replace previously missing or estimated valuations in either direction. Keep already-exact valuations, actual provider-reported charges and token/request counts unchanged. An exact catalog match describes valuation quality, not proof that today's price was effective on the historical usage date.

## Existing code to change

| Area | Current behavior | Required change |
| --- | --- | --- |
| `src/lib/core/pricing/cost.ts` and `modelsdev.ts` | Node snapshot loaders and permanent positive/negative lookup caches | Shared pure resolution with revision-scoped caches; server-only catalog loading and refresh |
| `src/lib/pricing-client.ts` | Independent constants and regexes | Consume the shared resolver and effective normalized catalog |
| `src/lib/core/providers/` and `src/lib/types.ts` | Calculated cost survives parsing, but billing-provider identity and threshold evidence can be lost | Carry valuation provenance and the original billing inputs through ingestion |
| `src/lib/core/history/store.ts` | Daily/model totals and sessions; Tokenmaxx backfill uses maximum costs | Persist eligible valuation evidence and monetary breakdowns; separate transactional correction operation |
| `src/lib/core/rollup/rollup.ts` | Frozen days skip records; live totals, hours and sessions update separately | Apply corrections to all retained views without ordinary re-ingestion or duplicated usage |
| `src/lib/core/engine.ts` | Owns ingestion, persistence, polling, sync and snapshot replacement | Own refresh lifecycle, correction recovery and snapshot replacement |
| `src/lib/core/sync/store.ts` | Complete row replacement already permits lower costs | Republish corrected rows under their existing source scope |
| `src/lib/components/DetailSheet.svelte` and other price-math consumers | Explain stored cost with current client rates | Render retained historical monetary components |

Use the current layout. The later Nx split moves these responsibilities into its agreed packages; it is not a prerequisite for this work. Reuse existing storage, snapshot replacement, sync publication and test facilities.

## Catalog and resolver contract

Keep fetch and filesystem code outside the browser import graph. One pure resolver accepts an immutable normalized catalog plus pricing provider, original model label and billing context. Its result distinguishes exact, estimated and missing valuations. A resolved result includes selected pricing identity, source revision and monetary components. Keep the original model label for display.

Normalize USD rates into one unit. Preserve explicit context tiers, threshold comparison semantics, cache read, cache-write duration and supported tool charges. Missing rates are not zero. An absent dimension only prevents an exact valuation when the usage needs it; explicitly free rates remain valid. Unsupported billing dimensions must not silently become base-rate exact costs.

Resolution order is deterministic:

1. Applicable documented corrective override for the exact provider/model and billing context.
2. Validated downloaded exact entries, preferring LiteLLM, then models.dev, for the same pricing provider and model. Select a complete applicable entry; do not splice conflicting rate fields together.
3. Bundled exact entries using the same source order.
4. Explicitly listed family representatives and existing cross-provider fallback mappings, classified as estimates.
5. Missing.

Same-source invalid or incomplete updates retain the last usable entry for that identity. Conflicting complete entries use the precedence above and retain their source provenance for diagnostics. Do not ask the user to choose catalog vendors. Regional or reseller prices never become an exact match for a different billing provider. Retain documented harness aliases that identify the same pricing provider.

Check literal exact IDs before recognized normalization. Normalize the terminal Claude Code `[1m]` annotation without inventing a multiplier. Preserve unknown suffixes. Add Fable and Mythos fallback representatives using their latest approved exact rows; unknown generations remain estimates. Keep older exact rows ahead of family fallback. Use the existing resolved model-pricing research tickets for the initial Fable 5.1, Mythos 5.1 and GPT-6 Astra entries and billing rules; do not invent sibling models or replace historical exact rates.

Bundled snapshots and runtime downloads use the same normalizer. Remove the hand-maintained client mirror and extend parity tests to execute both consumers, including exact IDs, aliases, estimates and misses.

## Refresh lifecycle

Use the existing models.dev and LiteLLM public catalog sources. Requests contain no usage, model-miss list, Account or project data. Keep the downloaded cache in the existing chaching data directory, separately from history so disabling history does not disable price caching.

At engine startup load the validated local cache, otherwise bundled data, synchronously with ordinary initialization. A running engine checks source freshness every 24 hours. An exact miss schedules an earlier refresh. Coalesce misses into one in-flight refresh per process; enforce a persisted 30-minute minimum interval between attempts, including failed fetches. Successful unchanged checks count as freshness checks. Missing models retry after cooldown rather than on every record.

Fetch each source with a five-second timeout and a 32 MiB response limit. Validate external data before normalization and promotion. Keep the last good revision when fetching, parsing or validation fails. Preserve explicit zeroes; reject negative and non-finite prices and invalid tier boundaries. Store source URL, check time, content hash and normalization version, plus conditional-request metadata when supplied. Never treat fetch time as a price-effective date.

Write the complete cache atomically using the repository's temporary-file-and-rename pattern. Serialize promotion using a short local filesystem lock, re-read the accepted generation under that lock and discard a fetch whose starting generation is stale. Network fetches do not hold the lock. Lock recovery must distinguish a dead process from a slow live writer. No separate daemon or new locking dependency is needed.

Ingestion continues using available prices during refresh. Long-running engines install accepted revisions, invalidate all lookup caches and retry affected models. Short-lived commands permit refresh within the same five-second bound before their final snapshot, then cancel outstanding work on disposal; they leave the validated cache for the next invocation. No detached worker keeps a command alive.

Publish normalized pricing data and its revision through the existing snapshot contract. On catalog installation or completed correction, use the existing full snapshot replacement path so the browser never mixes an old catalog with new valuations. Old exact history always renders its retained monetary breakdown.

## Evidence and persistence

Extend history with one valuation table keyed by the existing source scope plus stable record identity. For missing/estimated records retain timestamp, day, session, attribution keys, billing provider, original and normalized model, token classes, cache-duration split, prompt count used to choose a tier, supported tool counters, prior monetary components and provenance. Never store prompt or response content.

Persist this evidence before source pruning can erase it, including the current day. Commit evidence with its corresponding durable contribution; existing freeze-only aggregate persistence is insufficient. Replay must distinguish an already persisted contribution from a newly discovered one. Retain the committed exact result and dedup identity after repair so restarting or rescanning cannot restore its old estimate.

Persist the monetary breakdown of exact contributions too, aggregated where possible. Retain sufficient complete hourly/session contributions to replace affected pooled rows. A collection of only eligible records cannot reconstruct an hour that also contains exact-priced usage. Reuse this daily/session evidence for Wrapped where compatible, without implementing Wrapped in this change.

Migrate legacy history additively. Mark existing evidence-free valuations as legacy, preserve their stored totals and never infer eligibility from a model name or today's catalog. Recovery from surviving source records is allowed only when it proves the original contribution and identity. With history disabled, correction is limited to evidence still held in memory or surviving sources; it cannot promise recovery after pruning or restart.

## Correction transaction and publication

For each newly exact eligible valuation, calculate replacement monetary components from retained billing inputs. In one SQLite transaction replace the valuation, apply the cost difference to its complete retained aggregates, update unknown counts when a missing valuation becomes known and mark affected publication scopes dirty. Conditional eligibility prevents applying a correction twice. Tokens, requests, fees, ownership and coverage do not change.

After commit, update the in-memory views and publish complete affected day, hour and session rows using existing source scopes. Persist pending publication until successful acknowledgement; a crash after local commit must retry publication on restart. Consumers use the source owner's valuation and do not independently repair peer data. Account-scoped sources retain the existing ownership rules.

Do not route this through the maximum-only Tokenmaxx backfill. Keep upward-only token reconciliation intact. Synthetic reconciliation deltas do not carry original request thresholds, so classify their valuation separately and correct only when available evidence is sufficient. Repeated reconciliation must not resurrect an older cost after a supported correction. When Account shares use estimated event values, recompute the affected shares from retained eligible evidence while preserving the combined reconciled total and leaving unsupported gaps unassigned.

Propagate monetary changes consistently to totals, cache breakdowns, dashboard, text, JSON, receipts and Wrapped inputs. Do not add new cost-disclosure copy. Reuse existing unknown-value behavior.

## Implementation sequence and acceptance

1. Extract shared normalization/resolution and add approved exact rows. Fixture tests cover provider identity, literal and normalized IDs, known-family estimates, unknown families, zero rates, missing billed dimensions, context boundaries and cache durations. Browser safety tests reject Node imports.
2. Add provenance and durable contribution storage before enabling automatic correction. Reopen a fixture history database after source deletion and prove that eligible evidence survives, legacy totals do not change and re-ingestion does not double-count.
3. Add correction transactions and publication recovery. Prove upward and downward repairs, unchanged exact/reported costs and token counts, idempotent retry, restart after local commit, mixed exact/estimated hours and sessions, and unchanged reconciliation totals.
4. Add bounded refresh/cache lifecycle and snapshot delivery. Use local HTTP fixtures for daily refresh, exact misses hidden by family estimates, burst coalescing, cooldown, conditional checks, invalid payloads, offline fallback, racing writers, negative-cache invalidation and command disposal.
5. Verify a packaged CLI from an unrelated working directory, a live dashboard receiving a refreshed catalog and corrected snapshot, and two disposable pool clients exchanging corrected rows. Run the existing test, typecheck and build gates. No live pool migration is part of this handoff.

The feature is complete only when all five steps pass. A catalog fetcher alone does not fulfill the approved historical correction requirement.
