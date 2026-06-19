# chaching

```
  ██████╗██╗  ██╗ █████╗  ██████╗██╗  ██╗██╗███╗   ██╗ ██████╗
 ██╔════╝██║  ██║██╔══██╗██╔════╝██║  ██║██║████╗  ██║██╔════╝
 ██║     ███████║███████║██║     ███████║██║██╔██╗ ██║██║  ███╗
 ██║     ██╔══██║██╔══██║██║     ██╔══██║██║██║╚██╗██║██║   ██║
 ╚██████╗██║  ██║██║  ██║╚██████╗██║  ██║██║██║ ╚████║╚██████╔╝
  ╚═════╝╚═╝  ╚═╝╚═╝  ╚═╝ ╚═════╝╚═╝  ╚═╝╚═╝╚═╝  ╚═══╝ ╚═════╝
```

*cha-ching. it counts the cache hits too.*

Local, multi-provider AI token spend monitor for Claude Code, Codex, OpenCode, and Cursor. Reads your machine's own artifacts — no cloud, no account, no tracking.

<!-- screenshot / asciinema placeholder — add one here before the npm announcement -->

---

## Install

```sh
# zero-install try
npx chaching

# or with pnpm
pnpm dlx chaching

# or install globally
npm i -g chaching
chaching
```

**Node >= 24.16 is required.** The OpenCode provider reads a local SQLite database via Node's built-in `node:sqlite` module, which shipped in Node 24.16. If you only use Claude Code / Codex / Cursor, any recent Node LTS will work once that module is shimmed — but 24.16 is the safe pick.

---

## Commands

### `chaching` — always-on TUI dashboard

The default mode. Runs an interactive terminal dashboard that stays open and updates live as your AI tools write new records.

```
  TODAY      WEEK       MONTH      TOTAL
  $12.40     $87.22     $312.10    $1,048.33

  claude-code   ████████████████████  $10.21  (82%)
  codex         ████                   $2.19  (18%)

  trend (7d) ▁▂▃▂▄▅▆▇█▇▅▄▃
```

Keys: `d` / `w` / `m` switch the period (or `←` / `→` to step through it), number keys `1`-`9` toggle individual providers in the filter, `0` clears the filter, `q` / `Ctrl-C` quits cleanly. Add `--no-art` (or set `CHACHING_NO_ART`) to suppress the banner.

### `chaching stats` — one-shot print

Prints totals, per-provider and per-model breakdown, and the earliest covered date, then exits.

```sh
chaching stats                        # all-time totals (default)
chaching stats --period day           # just today
chaching stats --period week          # this week
chaching stats --period month         # this month
chaching stats --provider claude      # single-provider filter
chaching stats --json                 # machine-readable JSON snapshot
```

Sample output:

```
💰 chaching — AI token spend register

earliest data: 2026-05-20

PROVIDER         COST       INPUT       OUTPUT      CACHE_READ  REQUESTS
claude-code      $10.21     4,210,033   384,211     12,300,411  847
codex            $2.19      891,002     44,312       —          103

MODEL                          COST
claude-sonnet-4-5              $8.44
claude-opus-4                  $1.77
o4-mini                        $2.19
```

### `chaching serve` — web dashboard

Starts the SvelteKit web app on port 5178. Same data, browser UI with uPlot trend charts, donut breakdown, and a detail sheet.

```sh
chaching serve
# → http://0.0.0.0:5178
```

### `chaching init` — setup wizard

First-run wizard. Runs automatically the first time you invoke `chaching` with no config file. Re-run it any time to reconfigure.

```sh
chaching init
```

Presents a checklist of providers (all enabled by default), prompts for any required secrets (Cursor admin token), writes `~/.config/chaching/config.json` at mode `0600`.

### `chaching provider add|enable|disable`

Flip individual providers without going through the full wizard.

```sh
chaching provider enable cursor
chaching provider disable codex
chaching provider add opencode
```

---

## Providers

| Provider | What it reads | Notes |
|---|---|---|
| **Claude Code** | `~/.claude/projects/**/*.jsonl` and `~/.config/claude/projects/**/*.jsonl` | De-duplicated by `message.id:requestId`. 30-day log retention. |
| **Codex** | `~/.codex/sessions/**` (JSONL) | Uses `last_token_usage`, not cumulative totals, so repeated turn snapshots don't inflate spend. |
| **OpenCode** | `~/.local/share/opencode/opencode.db` (SQLite) | Read via `node:sqlite`. Requires Node >= 24.16. |
| **Cursor** | Cursor Admin API (`POST api.cursor.com/teams/filtered-usage-events`) | Requires an admin API token. Set `CURSOR_ADMIN_API_TOKEN` in your environment or provide it during `chaching init`. `chargedCents` is treated as authoritative cost. |

All providers are read-only on local files. Cursor is the only one that makes a network call.

---

## Configuration

Config lives at the XDG path:

```sh
${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json
```

If the file is missing, chaching enables Claude Code, Codex, and OpenCode with sensible defaults. Cursor is off until you supply a token.

See [CONFIG.md](CONFIG.md) for the full schema. A ready-to-edit example is in [`config.example.json`](config.example.json).

```json
{
  "cutoverTs": null,
  "server": { "host": "0.0.0.0", "port": 5178 },
  "providers": {
    "claude": { "enabled": true, "roots": ["~/.claude", "~/.config/claude"] },
    "codex": { "enabled": true, "root": "~/.codex/sessions" },
    "opencode": { "enabled": true, "dbPath": "~/.local/share/opencode/opencode.db" },
    "cursor": { "enabled": false, "adminApiToken": "", "email": null, "pollSeconds": 3600 }
  }
}
```

### Expose over your network with Tailscale

```sh
tailscale serve --bg 5178
# open the printed https://<machine>.<tailnet>.ts.net/ on your phone or another machine
# stop sharing:
tailscale serve --https=443 off
```

---

## Cost and honesty

**These are estimates, not invoices.** Provider token counts are best-effort; rounding and sampling happen at the source.

- **Claude cost** = sum over input / output / cache-creation / cache-read tokens times per-token price. Price resolution: hand-maintained overrides for new models, vendored LiteLLM snapshot (`static/pricing/litellm-prices.json`), family fallback, or "unknown" (never silently $0).
- **Reasoning tokens** fold into `output_tokens` in the Claude logs. No separate per-reasoning breakdown.
- **Work vs personal** attribution is not in any local log file. The optional cutover timestamp in the footer (persisted to config) is a user-set approximation.
- **Cursor** attribution is per-user/service-account from the Admin API. Local project or session breakdown is not available.
- **30-day window**: Claude Code prunes logs older than ~30 days. The UI shows the earliest covered date.

---

## How it works

On first connect, chaching runs a cold scan: reads all enabled providers once through to EOF, parses and de-duplicates records, and builds an in-memory rollup keyed by `(day, provider, model)`. Claude Code files are then tailed with `fs.watch` plus an mtime-poll fallback so new spend appears within a few seconds.

The web app and TUI share the same in-process engine. `chaching stats` uses a one-shot path (cold scan, no watchers, then exit). The SvelteKit server (`chaching serve`) keeps the singleton warm for the lifetime of the process.

SSE (`GET /api/feed`) delivers a snapshot on connect and deltas as they arrive. The web client pauses when the tab is hidden (Page Visibility API), which is the main idle-CPU win for a dashboard running on a second monitor.

---

## Refresh the price map

The vendored snapshot is `static/pricing/litellm-prices.json` (Claude entries only). To pull a fresh copy:

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

For a model that isn't in LiteLLM yet, add an exact-id row to `src/lib/core/pricing/overrides.ts` — it takes precedence over the snapshot.

---

## Building from source

```sh
npm install
npm run build              # SvelteKit build + CLI bundle
npm run start              # runs the CLI (bare = TUI dashboard)
npm run start -- serve     # or boot the web server on :5178
```

`npm run start` is just `node bin/chaching.js`, so it takes the same subcommands as the published binary. Dev mode for the web app (hot reload, :5178):

```sh
npm run dev
```

| command | what |
|---|---|
| `npm run dev` | web dev server on :5178 (hot reload) |
| `npm run build` | adapter-node build + CLI bundle |
| `npm run start` | run the CLI (`-- serve` for the web server) |
| `npm run check` | svelte-check (types) |
| `npm test` | vitest unit tests |
| `npm run pack:dry` | inspect package contents before publishing |

---

## License

[PolyForm Noncommercial 1.0.0](LICENSE) — free for noncommercial use with attribution. If you want to use it commercially, get in touch.
