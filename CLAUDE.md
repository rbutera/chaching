# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

chaching is a local, multi-provider AI token-spend dashboard for Claude Code, Codex, OpenCode, and Cursor. It is a **single codebase with two front-ends sharing one in-process engine**: an Ink/React terminal UI and a SvelteKit web app. No cloud, no telemetry — it reads local logs/SQLite (and, only if enabled, Cursor's Admin API).

## Commands

```sh
npm run dev          # SvelteKit web dev server on :5178 (hot reload)
npm run build        # full build: build:sk (vite/adapter-node) + build:cli (tsup)
npm run build:cli    # CLI bundle only → dist/cli/  (pretest runs this automatically)
npm run start        # run the built CLI (bare = TUI); `npm run start -- serve` for web
npm run check        # svelte-check (type checking); use this as the "lint"/typecheck gate
npm test             # vitest run (runs build:cli first via pretest)
npm run pack:dry     # inspect publishable package contents
```

Run a single test file or pattern:

```sh
npx vitest run src/lib/core/pricing/cost.test.ts
npx vitest run -t "freeze"           # by test-name substring
npx vitest                            # watch mode
```

**Node >= 24.16 is mandatory** (`engine-strict=true` in `.npmrc`). The history DB and OpenCode provider use Node's built-in `node:sqlite`, which shipped in 24.16. There are no native addons or build steps beyond bundling.

**Use `pnpm`** — it is the canonical package manager (`pnpm install`, `pnpm dev`, `pnpm test`, etc.). A `package-lock.json` is also present but `pnpm-lock.yaml` is authoritative.

## Architecture

### One engine, two consumers

`src/lib/core/engine.ts` is the framework-free ingestion engine and the heart of the app. It runs **one cold scan per engine** (stream every enabled provider's source to EOF, parse, de-dup, build an in-memory `Rollup` keyed by `(day, provider, model)`), then tails Claude Code logs via `fs.watch` + an mtime-poll fallback, fanning `RollupDelta`s to subscribers.

- `createEngine()` → live engine (watchers + Cursor polling); used by `chaching serve` and the TUI.
- `runOnce()` → single cold scan, snapshot, dispose (no lingering timers); used by `stats` and `receipt`.
- The SvelteKit server holds **one engine per Node process** via `src/lib/server/service.ts` (`getService()` singleton), streaming snapshots/deltas over SSE at `GET /api/feed`. The web client pauses when the tab is hidden.

### Providers (`src/lib/core/providers/`)

Each provider ingests into the same `Rollup` via `UsageRecord`s, de-duplicated by `rec.key`:
- **claude** — tails `~/.claude` + `~/.config/claude` `**/*.jsonl`; dedup key `message.id:requestId`. The only *tailed/watched* provider.
- **codex** — reads `~/.codex/sessions/**` JSONL; uses `last_token_usage` (not cumulative) to avoid double-counting turn snapshots.
- **opencode** — reads the OpenCode DB's `message` table via `node:sqlite` (one record per assistant message; the old `session`-column schema is gone). OpenCode reports `cost: 0` for Zen/Go/subscription usage, so cost is **computed** from the vendored models.dev map (`resolveModelsDevPrice`), not trusted — falling back to the DB `cost` only when the resolver is unknown and that cost is positive, else `null`.
- **cursor** — two sources: (1) **local** via the opencode-cursor bridge — OpenCode rows tagged `providerID: cursor-acp` are attributed to the `cursor` provider (priced through models.dev's Anthropic catalog); (2) the **optional** Cursor Admin API (`POST api.cursor.com/teams/filtered-usage-events`, the only network call, admin token, polled, `chargedCents` authoritative). The two have non-colliding dedup keys, so enabling both double-counts — use one.

Provider ingest failures are recorded in `ProviderStatus`, never thrown — they degrade coverage instead of crashing.

### History: freeze-past-days (`src/lib/core/history/`)

Claude Code prunes logs at ~30 days. chaching keeps `~/.local/share/chaching/history.db` and **permanently snapshots each completed past day** (`day < today UTC`) before logs prune. Critical invariant: a day is frozen **only when the scan is clean** — `scanIsPartial()` (any unreadable file or provider error) gates freezing so a partial copy is never locked in. On startup, frozen aggregates seed the rollup *before* any live `rollup.add` so live tailing of already-frozen days is skipped (no double-count). A long-running process re-freezes across UTC midnight via `maybeFreezeLive()`.

### Coverage classification

Days are classified `frozen` / `partial` (today, or this run had errors) / `missing` (gap) / `zero` (real quiet day) — the UI must never render incomplete data as "$0". `coverageInput()` in the engine is the single source of the per-day facts (canonical today, partial signal, history-enabled) shared by snapshot and every delta, so the two never drift.

### Pricing (`src/lib/core/pricing/`)

Claude/Codex cost is always **computed** (`tokens × per-token price`), never read from a cost field. Resolution order (first hit wins): hand-maintained `overrides.ts` → vendored LiteLLM snapshot (`static/pricing/litellm-prices.json`) → normalised/family key → **unknown → null** (flagged, never silently zero).

**Two price maps, two resolvers.** `cost.ts` (LiteLLM + overrides) prices Claude/Codex by model id. `modelsdev.ts` (`resolveModelsDevPrice(providerID, modelID)`) prices OpenCode/Zen/Go/Cursor-ACP from the vendored `static/pricing/modelsdev-prices.json` (models.dev), per-million→per-token, provider-aware so cache economics stay accurate (Anthropic catalogs carry `cache_write`; OpenAI doesn't). It maps `cursor-acp`→anthropic, normalises ids like `opus-4.6`→`claude-opus-4-6`, prefers canonical catalogs over aggregator catalogs in cross-catalog fallback, and returns `null` when truly unknown. Both resolvers feed the **single** per-token formula `costFromPriceEntry` (exported from `cost.ts`) — don't re-implement it. Refresh the models.dev snapshot with `scripts/gen-modelsdev-prices.ts`. Genuinely-free models price at `$0` (intentional, distinct from `null` unknown).

- **Client/server split is enforced**: `src/lib/pricing-client.ts` is plain constants with **no Node imports** so the full price table stays out of the browser bundle. It *mirrors* `overrides.ts`/the snapshot — keep them in sync. `client-safety.test.ts` guards this.
- To add a missing model, add an exact-id row to `overrides.ts` (wins over the snapshot). Refresh the snapshot with the `jq` pipeline in `README.md` ("Refresh the price map").

### CLI (`src/cli/`)

- `bin/chaching.js` is a thin launcher → `dist/cli/index.js`. One-shot commands are force-`exit(0)`'d (Ink/clack leave stdin handles open); `serve` is exempt because its listening socket keeps the process alive.
- `router.ts` is a **hand-rolled** subcommand dispatcher and arg parser (no third-party arg lib, per design decision "D3"). Subcommands: `stats`, `receipt`, `serve`, `init`, `provider`, plus bare (TUI). `serve` lazy-imports the built SvelteKit server.
- TUI is React/Ink under `src/cli/tui/` (`.tsx`, automatic JSX runtime).
- Receipt rendering lives in `src/cli/receipt/`; PNG export lazily `import()`s `satori` + `@resvg/resvg-js` (kept external/optional — see build notes).

### Receipt/dashboard period semantics

`stats`/`receipt`/dashboard periods are a **rolling window anchored at the latest day with data** (`month` = last 30 days, `week` = last 7, etc.), so `receipt --period month` always equals the dashboard's "month". The **one exception** is the SUBSCRIPTION SUBSIDY footer, which is calendar-month month-to-date (it reconciles against a monthly fee).

## Build gotchas

- **`tsup.config.ts` post-build step rewrites `from "sqlite"` → `from "node:sqlite"`** because esbuild strips the `node:` prefix from the experimental builtin. Don't remove `onSuccess`.
- `satori` and `@resvg/resvg-js` are kept **external** in both tsup and adapter-node (they're `optionalDependencies` + listed in `dependencies` so adapter-node externalizes the native binding). They must remain runtime-resolved, never bundled — a CLI-only install can skip the native renderer.
- Svelte is in **forced runes mode** (`svelte.config.js`) for all non-`node_modules` files.
- Vitest defaults to the `node` environment for speed; component tests opt into jsdom per-file with `// @vitest-environment jsdom`.

## Conventions

- Cost honesty is a hard rule: prefer "unknown"/null and explicit coverage marks over a fabricated `$0`. Comparisons only render against a real prior window.
- Code comments in this repo reference design-decision tags (e.g. "D2", "D3", "D5") — preserve them and follow the documented invariant when editing nearby code.
- Receipts show real user/host/paths by default; `--redact` (CLI) / `?redact=1` (web) scrubs them.
