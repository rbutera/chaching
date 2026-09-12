# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

chaching is a local, multi-provider AI token-spend dashboard for Claude Code, Codex, OpenCode, and Cursor. It is a **single codebase with two front-ends sharing one in-process engine**: an Ink/React terminal UI and a SvelteKit web app. No cloud, no telemetry — it reads local logs/SQLite (and, only if enabled, Cursor's Admin API).

## Commands

```sh
pnpm install         # pinned pnpm, isolated workspace dependencies
pnpm dev             # web development server
pnpm check           # architecture controls and all workspace typechecks
pnpm test            # library, component and packaged CLI tests
pnpm build           # CLI and dashboard builds
pnpm package         # assemble the sole public distribution in dist/chaching
pnpm verify:package  # install and exercise the tarball outside the repository
pnpm start -- serve  # serve the assembled dashboard
```

Run a single test file or pattern:

```sh
pnpm --dir packages/core exec vitest run src/pricing/cost.test.ts
npx vitest run -t "freeze"           # by test-name substring
npx vitest                            # watch mode
```

**Node >= 24.16 is mandatory** (`engine-strict=true` in `.npmrc`). The history DB and OpenCode provider use Node's built-in `node:sqlite`, which shipped in 24.16. There are no native addons or build steps beyond bundling.

**Use `pnpm`** — it is the canonical package manager (`pnpm install`, `pnpm dev`, `pnpm test`, etc.). `pnpm-lock.yaml` is the only lockfile. Node 26.7.0 is pinned for development; the supported floor is 24.16.0.

## Architecture

### One engine, two consumers

`packages/core/src/engine.ts` is the framework-free ingestion engine and the heart of the app. It runs **one cold scan per engine** (stream every enabled provider's source to EOF, parse, de-dup, build an in-memory `Rollup` keyed by `(day, provider, model)`), then keeps every provider live: Claude Code logs are tailed via `fs.watch` + an mtime-poll fallback; codex + opencode are re-polled every 15s (codex re-parses only mtime-fresh session files, opencode re-reads only when the db/-wal mtime moved — dedup makes the overlap safe); cursor polls its Admin API. Deltas fan out to subscribers as `RollupDelta`s.

- `createEngine()` → live engine (watchers + Cursor polling); used by `chaching serve` and the TUI.
- `runOnce()` → single cold scan, snapshot, dispose (no lingering timers); used by `stats` and `receipt`.
- The SvelteKit server holds **one engine per Node process** via `apps/web/src/lib/server/service.ts` (`getService()` singleton), streaming snapshots/deltas over SSE at `GET /api/feed`. The web client pauses when the tab is hidden.

### Providers (`packages/core/src/providers/`)

Each provider ingests into the same `Rollup` via `UsageRecord`s, de-duplicated by `rec.key`:
- **claude** — tails `~/.claude` + `~/.config/claude` `**/*.jsonl`; dedup key `message.id:requestId`. The only *line-tailed* provider.
- **codex** — reads `~/.codex/sessions/**` JSONL; uses `last_token_usage` (not cumulative) to avoid double-counting turn snapshots. Long-running processes re-poll incrementally (mtime-fresh files only) every 15s.
- **opencode** — reads the OpenCode DB's `message` table via `node:sqlite` (one record per assistant message; the old `session`-column schema is gone). Long-running processes re-read the db on the 15s local poll, but only when the db/-wal mtime moved. OpenCode reports `cost: 0` for Zen/Go/subscription usage, so cost is **computed** from the vendored models.dev map (`resolveModelsDevPrice`), not trusted — falling back to the DB `cost` only when the resolver is unknown and that cost is positive, else `null`.
- **cursor** — two sources: (1) **local** via the opencode-cursor bridge — OpenCode rows tagged `providerID: cursor-acp` are attributed to the `cursor` provider (priced through models.dev's Anthropic catalog); (2) the **optional** Cursor Admin API (`POST api.cursor.com/teams/filtered-usage-events`, the only network call, admin token, polled, `chargedCents` authoritative). The two have non-colliding dedup keys, so enabling both double-counts — use one. **In a sync pool this is pool-wide:** the bridge attributes cursor spend per machine while the Admin API attributes it to the shared account, so if ANY machine bridges while ANY machine polls the Admin API, the same spend is counted twice across the pool. Pick one path for the whole pool. (Pooled, the Admin API total is the last writer's rolling-30-day view and can wobble slightly between bursts.)

Provider ingest failures are recorded in `ProviderStatus`, never thrown — they degrade coverage instead of crashing.

### History: freeze-past-days (`packages/core/src/history/`)

Claude Code prunes logs at ~30 days. chaching keeps `~/.local/share/chaching/history.db` and **permanently snapshots each completed past day** (`day < today UTC`) before logs prune. Critical invariant: a day is frozen **only when the scan is clean** — `scanIsPartial()` (any unreadable file or provider error) gates freezing so a partial copy is never locked in. On startup, frozen aggregates seed the rollup *before* any live `rollup.add` so live tailing of already-frozen days is skipped (no double-count). A long-running process re-freezes across UTC midnight via `maybeFreezeLive()`.

### Coverage classification

Days are classified `frozen` / `partial` (today, or this run had errors) / `missing` (gap) / `zero` (real quiet day) — the UI must never render incomplete data as "$0". `coverageInput()` in the engine is the single source of the per-day facts (canonical today, partial signal, history-enabled) shared by snapshot and every delta, so the two never drift.

### Pricing

`packages/shared/src/pricing/catalog.ts` owns the pure provider-aware resolver. Core fetches catalogs daily and after missing exact-model prices, persists validated snapshots, and retains the last good snapshot offline. The browser receives the same catalog revision with the usage snapshot. Retained monetary components preserve known-rate usage; exact prices repair earlier estimates and missing values without changing token counts. Zero is a known free rate; null remains unknown.

### CLI (`packages/cli/src/`)

- `bin/chaching.js` is a thin launcher → `dist/chaching/cli/index.js`. One-shot commands are force-`exit(0)`'d (Ink/clack leave stdin handles open); `serve` is exempt because its listening socket keeps the process alive.
- `router.ts` is a **hand-rolled** subcommand dispatcher and arg parser (no third-party arg lib, per design decision "D3"). Subcommands: `stats`, `receipt`, `serve`, `init`, `provider`, plus bare (TUI). `serve` lazy-imports the built SvelteKit server.
- TUI is React/Ink under `packages/cli/src/tui/` (`.tsx`, automatic JSX runtime).
- Receipt rendering lives in `packages/receipt/src/receipt/`; PNG export lazily `import()`s `satori` + `@resvg/resvg-js` (kept external/optional — see build notes).

### Receipt/dashboard period semantics

`stats`/`receipt`/dashboard periods are a **rolling window anchored at the latest day with data** (`month` = last 30 days, `week` = last 7, etc.), so `receipt --period month` always equals the dashboard's "month". The **one exception** is the SUBSCRIPTION SUBSIDY footer, which is calendar-month month-to-date (it reconciles against a monthly fee).

## Build gotchas

- **`packages/cli/tsup.config.ts` post-build step rewrites `from "sqlite"` → `from "node:sqlite"`** because esbuild strips the `node:` prefix from the experimental builtin. Don't remove `onSuccess`.
- `satori` and `@resvg/resvg-js` are kept **external** in both tsup and adapter-node (the assembled package declares them as optional runtime dependencies). They must remain runtime-resolved, never bundled — a CLI-only install can skip the native renderer.
- Svelte is in **forced runes mode** (`svelte.config.js`) only for each application’s own source files.
- Vitest defaults to the `node` environment for speed; component tests opt into jsdom per-file with `// @vitest-environment jsdom`.
- **Serve base path vs origin.** A subpath mount (`/chaching`) is SvelteKit `kit.paths.base`, baked in at **build time** from `CHACHING_BASE_PATH` (via `normalizeBasePath` in `packages/shared/src/base-path.js` — kept as plain `.js` because `svelte.config.js` loads as raw Node ESM and can't import a `.ts`). The web client must therefore call internal endpoints through `resolve()` from `$app/paths` (e.g. `resolve('/api/feed')`), never a bare `/api/...`. The public **origin** is separate and runtime: adapter-node's `ORIGIN` env (or `server.origin` config, applied in `serve.ts`). Assets resolve relatively (SvelteKit `paths.relative` default), so a subpath build needs no asset-URL baking. **A subpath deployment behind a prefix-preserving reverse proxy MUST be built with `CHACHING_BASE_PATH` set** — a bare `pnpm build` produces a root-path build that 404s every proxied request. After deploying, verify the built artifact itself serves `<base>/` (e.g. probe it on a scratch port) rather than trusting a live probe fired straight after a restart, which can race and report a stale 200.

## Conventions

- Cost honesty is a hard rule: prefer "unknown"/null and explicit coverage marks over a fabricated `$0`. Comparisons only render against a real prior window.
- Code comments in this repo reference design-decision tags (e.g. "D2", "D3", "D5") — preserve them and follow the documented invariant when editing nearby code.
- Receipts show real user/host/paths by default; `--redact` (CLI) / `?redact=1` (web) scrubs them.

## Workspace boundaries

The six private workspaces are shared, core, receipt, CLI, dashboard, and site. Shared has no first-party dependencies; core and receipt depend on shared; CLI depends on those three. Browser imports remain within shared and pure receipt modules. Fetching, persistence, native PNG rendering, and core imports stay on the server. Use explicit package export subpaths across workspaces and relative imports within one workspace.

When changing builds, boundaries, or packaging, read `docs/specs/nx-monorepo.md` and run `pnpm boundaries` plus the installed-package verification. The site builds separately from the CLI/dashboard distribution.
