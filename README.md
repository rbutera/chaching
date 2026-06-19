# chaching

A mobile-first, always-on dashboard for local AI token spend across **Claude
Code**, **Codex**, **OpenCode**, and **Cursor**. It reads local usage artifacts
read-only where possible, optionally polls the Cursor Admin API, de-duplicates
streamed records, and shows day/week/month trends with per-provider and
per-model breakdowns and drill-down.

Built with SvelteKit (Svelte 5 runes) + TypeScript, `@sveltejs/adapter-node`.
Charting is a deliberate hybrid: **uPlot** (canvas, ~10% CPU at 60fps) for the
dense always-on trend, and hand-rolled SVG (d3-scale/d3-shape as pure helpers)
for the sparkline, donut, and split bars. Dark-mode-first.

> **Personal tool.** Not launchpad/client code; no Fusion/C# conventions apply.

## Run From Source

```sh
npm install
npm run build
npm run start          # serves on http://0.0.0.0:5178 by default
```

`npm run start` runs the `chaching` CLI, which starts the built SvelteKit
server. Dev mode (`npm run dev`, also on 5178) has the same behaviour but slower
first paint.

## Configuration

chaching reads configuration from:

```sh
${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json
```

If the file is absent, these providers are enabled by default:

- Claude Code: `~/.claude` and `~/.config/claude`
- Codex: `~/.codex/sessions`
- OpenCode: `~/.local/share/opencode/opencode.db`

Cursor is disabled by default because it requires a Cursor Admin API token. Copy
`config.example.json` to the XDG config path to customize providers, host, port,
or Cursor settings. See [CONFIG.md](CONFIG.md) for the full schema.

### Expose to your phone over Tailscale

```sh
tailscale serve --bg 5178
# then open the printed https://<machine>.<tailnet>.ts.net/ on your phone
# stop sharing with:  tailscale serve --https=443 off
```

## How it works

- **Cold scan (once per server):** on the first client connect, a singleton
  service streams enabled local providers once to EOF where applicable, reads the
  OpenCode SQLite session table, and optionally fetches Cursor Admin API usage.
- **Incremental tail:** Claude Code JSONL files are tailed with `fs.watch` plus
  an mtime poll fallback. New usage is parsed, de-duplicated, folded into the
  rollup, and pushed as a delta.
- **SSE:** `GET /api/feed` sends a snapshot on connect, then deltas. The client
  pauses the subscription when the tab is hidden (Page Visibility API) — the key
  idle-CPU win for a 2nd-monitor tab. `GET /api/snapshot` is a plain-JSON
  equivalent for scripting/verification.
- **Rollup grain:** per-(day, provider, model) token-class + request + cost
  aggregates, a session index, a rolling 5-hour-block (cap-proximity) view, and
  the earliest covered date. Day/week/month and month→day→session
  re-aggregation happen in-memory on the client.

## Cost + correctness

- **Claude de-dup** by `${message.id}:${requestId}` across the merged top-level +
  subagent set. Null-id lines are counted as-is.
- **Codex** uses `last_token_usage`, not cumulative `total_token_usage`, so
  repeated turn snapshots do not inflate spend.
- **OpenCode** uses local SQLite session totals from `node:sqlite`.
- **Cursor** uses Cursor Admin API `chargedCents` as the authoritative cost.
- **Claude cost** = Σ over the four token classes × per-token price. Price resolution:
  hand-maintained overrides (`src/lib/server/pricing/overrides.ts`) → vendored
  LiteLLM snapshot (`static/pricing/litellm-prices.json`) → family fallback →
  unknown (reported as unknown, never silently $0). 1h vs 5m cache writes are
  priced separately where the data carries the split.

## Limits (shown in the UI honesty footer)

- **Cost is an estimate**, not an invoice. Provider token counts are best-effort.
- **Reasoning/thinking is not separately metered** for Claude — it folds into
  `output_tokens`. No per-reasoning-level breakdown is shown.
- **Account attribution** (work vs personal) is **not** in Claude/Codex/OpenCode
  local data. The optional
  work/personal **cutover timestamp** (footer date picker, persisted to
  `~/.config/chaching/config.json`) is a user-set approximation, not inferred.
- **Cursor attribution** is limited to Cursor user/service-account data returned
  by the Admin API; local project/session attribution is not available.
- **30-day retention:** Claude Code prunes logs older than ~30 days; the UI states
  the earliest covered date.

## Package / Publish Prep

This repo is prepared for npm-style distribution with a `chaching` bin. A
publishable package must include a built `build/` directory, so run:

```sh
npm run build
npm run pack:dry
```

Before any external publish, choose the final package name/scope, license, public
repository URL, and whether this directory should become a standalone repo or a
submodule. Do not run `npm publish`, create a GitHub repo, or edit `.gitmodules`
until those choices are explicit.

## Refresh the price map

The vendored snapshot is `static/pricing/litellm-prices.json` (Claude entries
only, trimmed to the four cost fields). To refresh:

```sh
curl -s https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json \
| jq '{ _meta: { source: "litellm", snapshot_date: (now|strftime("%Y-%m-%d")) },
        prices: ([ to_entries[] | select(.value|type=="object")
          | select(.key|test("claude";"i"))
          | select(.value.input_cost_per_token != null)
          | { key: .key, value: {
              input_cost_per_token: .value.input_cost_per_token,
              output_cost_per_token: .value.output_cost_per_token,
              cache_creation_input_token_cost: .value.cache_creation_input_token_cost,
              cache_creation_input_token_cost_above_1hr: .value.cache_creation_input_token_cost_above_1hr,
              cache_read_input_token_cost: .value.cache_read_input_token_cost } } ] | from_entries) }' \
> static/pricing/litellm-prices.json
```

If a brand-new model id appears before LiteLLM lists it, add an exact-id row to
`src/lib/server/pricing/overrides.ts` (it wins over the snapshot).

## Scripts

| command | what |
|---|---|
| `npm run dev` | dev server on :5178 |
| `npm run build` | adapter-node production build |
| `npm run start` | serve the build on :5178 (all interfaces) |
| `npm run check` | svelte-check (types) |
| `npm test` | vitest unit tests (dedup, cost, parse, aggregation) |
| `npm run pack:dry` | inspect npm package contents without publishing |

## Layout

```
src/lib/server/ingest/   discover, parse, dedup
src/lib/server/providers/ codex, opencode, cursor adapters
src/lib/server/pricing/  cost (resolver), overrides (exact-id rows)
src/lib/server/rollup/   in-memory rollup + 5h blocks
src/lib/server/watch/    streaming cold scan + incremental tail
src/lib/server/service.ts singleton: cold scan once, watch, SSE fan-out
src/lib/aggregate.ts     pure day/week/month + per-model re-aggregation
src/lib/client/          FeedStore (SSE + visibility pause), Dashboard view-model
src/lib/components/      TrendChart (uPlot), Donut, Sparkline, cards, DetailSheet…
src/routes/api/          /api/feed (SSE), /api/snapshot, /api/config
static/pricing/          vendored LiteLLM price snapshot
```
