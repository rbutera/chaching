# chaching Configuration

chaching reads configuration from:

```sh
${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json
```

If the file is missing or malformed, chaching falls back to safe defaults:
Claude Code, Codex, OpenCode, and Pi / OMP local providers are enabled; Cursor Admin API is disabled.

Start from the example:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/chaching"
cp config.example.json "${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json"
```

## Server

```json
"server": {
	"host": "127.0.0.1",
	"port": 5178,
	"origin": ""
}
```

The `chaching` CLI uses these values unless `HOST` or `PORT` is already set in the environment.

`origin` is the public base URL for the web server when it sits behind a reverse proxy, e.g. `"https://chaching.example.com"` — it populates adapter-node's `ORIGIN` so absolute links/redirects are correct. The `ORIGIN` environment variable, if set, wins over this. Leave it `""` to let the adapter infer the origin from the request.

**Subpath (base path) is build-time, not config.** To mount the dashboard under a path like `https://example.com/chaching/`, build with `CHACHING_BASE_PATH=/chaching pnpm build` (SvelteKit bakes the base path into the bundle — there is no runtime base-path setting). The published npm package is built at the root. `chaching serve` reads `CHACHING_BASE_PATH` only to print the correct link.

## History

```json
"history": {
	"enabled": true,
	"dbPath": "~/.local/share/chaching/history.db"
}
```

chaching keeps a local SQLite store of finalized past-day aggregates so spend history
survives the source logs being pruned (Claude Code prunes roughly the last 30 days). The
DB lives under the XDG data dir, `${XDG_DATA_HOME:-$HOME/.local/share}/chaching/`, by
default.

A day is frozen into the DB exactly once, when it first appears as a complete past day
(day `< today`, UTC). Past-day logs never change, so freezing is safe and the DB copy is
authoritative thereafter. On every run chaching loads the frozen days from the DB and
skips re-scanning them from the logs, so spend is never double-counted; pruned days keep
showing up from the DB. Today is never frozen — it stays live from the log scan/tail and
is frozen on a future run, once it becomes a past day.

Set `enabled` to `false` to disable the store entirely (chaching then shows only what the
current logs cover). Uses Node's built-in `node:sqlite`, so it requires Node `>=24.16.0`.

## Tokenmaxx

```json
"tokenmaxx": {
	"enabled": true,
	"dbPath": "~/.tokenmaxx/state.sqlite"
}
```

Tokenmaxx is an auto-detected supplementary source. When its database exists, chaching compares
proxy-observed daily model totals with the Claude/Codex records already ingested and adds only the
positive difference. Transcript session and project attribution is preserved; proxy-only usage is
shown under `(Tokenmaxx background)`. Corrections to completed days are written into chaching's
history database, so they survive Tokenmaxx's event retention.

Tokenmaxx's Anthropic quota snapshots are published to a configured chaching Sync pool using
generic account labels. Email addresses, Tokenmaxx account IDs, credentials, and raw events are
never published. If the database or quota tables do not exist, this source is a no-op.

## Chaching Sync

```json
"sync": {
	"enabled": false,
	"databaseUrl": "",
	"poolId": null,
	"machineId": null,
	"machineName": "",
	"intervalMinutes": 15
}
```

Do not hand-author pool or machine IDs. Use `chaching sync create`, `chaching sync join`, the
setup wizard, or the web Sync panel. `databaseUrl` is a PostgreSQL connection string and is a
secret. The config file is written atomically with mode `0600`, and the URL is omitted from the
web public-config and sync-status APIs.

When `sync.enabled` is true and the connection identity is complete, this machine stays local-first
(local SQLite keeps recording and freezing) and additionally publishes compact aggregates to the
shared PostgreSQL pool. Raw records never leave the machine. `providerAccounts` is the local
provider-to-Account links, updated by discovery and manual mapping. When pooled, PostgreSQL supplies shared Account metadata and fees.

`intervalMinutes` (integer, min 1, default 15) is the wall-clock-aligned publish cadence: all pool
machines burst on the same grid instants so a serverless Postgres endpoint wakes once per window
and scales back to zero between them. Higher = cheaper on serverless Postgres; it only affects how
stale *peers'* data is (your own numbers are always live). Set it with `chaching sync interval
<minutes>` or the wizard. On a serverless free tier keep it at 15 or higher — see the Neon
arithmetic in docs/sync.md.

See [docs/sync.md](docs/sync.md) for Docker, Tailscale, Account mapping, the interval/cost
trade-off, dashboard filters, and the threat model.

## Providers

### Claude Code

```json
"claude": {
	"enabled": true,
	"roots": ["~/.claude", "~/.config/claude"]
}
```

chaching scans `projects/**/*.jsonl` under each root. Claude Code logs are read-only and de-duplicated by message/request id. Account fees drive the subsidisation card and receipt footer (see [Account fees](#account-fees) below).

### Codex

```json
"codex": {
	"enabled": true,
	"root": "~/.codex/sessions"
}
```

Codex usage is read from local JSONL session files. chaching uses `last_token_usage`, not cumulative totals, so repeated turn snapshots do not inflate spend. Account fees drive the subsidisation card and receipt footer (see [Account fees](#account-fees) below).

### OpenCode

```json
"opencode": {
	"enabled": true,
	"dbPath": "~/.local/share/opencode/opencode.db"
}
```

OpenCode usage is read from the local OpenCode SQLite database (the `message` table) through Node's built-in `node:sqlite` module — one record per assistant message. chaching requires Node `>=24.16.0` for this provider. Because OpenCode reports `cost: 0` for Zen/Go/subscription usage, cost is computed from the vendored [models.dev](https://models.dev) price map (`static/pricing/modelsdev-prices.json`), not trusted; genuinely-free models price at `$0`, unpriced models are flagged unknown (never a faked `$0`).

Usage reached through the [opencode-cursor](https://github.com/Nomadcxx/opencode-cursor) bridge (tagged `providerID: cursor-acp` in the OpenCode DB) is attributed to the **Cursor** provider, not OpenCode — see below.

### Pi / Oh My Pi

```json
"pi": {
	"enabled": true,
	"roots": ["~/.pi/agent/sessions", "~/.omp/agent/sessions"]
}
```

chaching recursively scans compatible version-3 JSONL sessions from both canonical
[pi-mono](https://github.com/badlogic/pi-mono) and [Oh My Pi](https://github.com/can1357/oh-my-pi),
including nested OMP subagent sessions. Both sources use the existing `pi` provider identity so
their history, polling, and sync attribution stay unified. Assistant response IDs deduplicate
history copied by session forks; cache TTL and server web-tool usage are preserved when present.

The historical singular `"root"` setting remains accepted. The old default
`"~/.pi/agent/sessions"` expands to both defaults on load, while a custom singular root remains
the only configured root. An explicit non-empty `"roots"` array always wins.

### Cursor

```json
"cursor": {
	"enabled": false,
	"adminApiToken": "",
	"email": null,
	"pollSeconds": 3600
}
```

chaching has **two** Cursor sources:

1. **Local, via the opencode-cursor bridge** (no config, no token). If you use Cursor models through [opencode-cursor](https://github.com/Nomadcxx/opencode-cursor), that usage is already in the OpenCode DB (`providerID: cursor-acp`) and is attributed to the Cursor provider automatically, priced from the models.dev map. This needs nothing turned on beyond the OpenCode provider.
2. **The Cursor Admin API** (the block above, disabled by default). Set `enabled` to `true` and provide an admin token to poll `POST https://api.cursor.com/teams/filtered-usage-events`. `chargedCents` is authoritative. Cursor events carry no local project/session attribution, so chaching groups them by Cursor user or service account.

> **Use one Cursor source, not both.** The bridge-local records (key `opencode:<id>`) and Admin-API records (key `cursor:<ts>:<owner>:<model>`) have non-colliding keys, so they do **not** dedup against each other — enabling both will double-count the same Cursor usage. If you use the opencode-cursor bridge, leave the Admin API disabled.

## Account fees

Config version 1 stores fees once in `accounts`; `providerAccounts` links this install's providers to their Account IDs. Settings edits these records. Account fees never change API-equivalent usage costs.

```json
{
  "version": 1,
  "accounts": [{
    "id": "claude-work",
    "provider": "claude",
    "name": "Work Claude",
    "tier": "max-20x",
    "monthlyUsd": 200,
    "feeSource": "explicit",
    "identity": null,
    "registrations": [],
    "legacy": false
  }],
  "providerAccounts": { "claude": ["claude-work"] }
}
```

`monthlyUsd` is a nonnegative fee in USD, or `null` when unknown. `feeSource` is `explicit` for a configured fee and `inferred` for a discovered preset or unknown fee. Private identity and registration metadata remain in the owner-only config and are omitted from public config responses. Do not edit discovered identity or retired registration aliases by hand.

Existing provider subscription settings migrate on first load. Migration preserves explicitly configured fees and mapped pooled IDs, allocates other IDs once, and keeps the original file at `config.json.pre-accounts`. Both files use mode `0600`; writes are atomic and migration rereads under a cross-process lock. If a writer is killed, stop all chaching processes before removing the reported `config.json.lock` directory and retrying. Missing fees do not become Corporate $99. A supported known tier may infer a fee; an unknown tier remains unknown. Existing usage history is unchanged, including when history storage is disabled.

Accounts added through sync setup are saved locally before pool publication. The optional `privateLabel` stays on this machine. A temporary `pendingPoolId` lets status refresh retry publication with the same Account ID after an outage or interrupted acknowledgement. Creating an Account or editing its fee does not map it to a machine; mapping and unmapping update `providerAccounts` while retaining the saved Account.

Tokenmaxx discovery creates Accounts by stable provider identity and retains registration aliases after removal. Re-registration reuses the Account. Explicit fees survive discovery; recognized plan IDs infer fees only when no override exists.

Legacy bills match automatically when tier evidence identifies one Account, or when matching bills are economically interchangeable. Conflicting candidates remain pending and fee comparisons stay unavailable. In Settings, match the login to its existing bill (preserving the bill ID and fee), or explicitly keep it separate and retain both fees. Discovery never rewrites machine-attributed usage as individual-login history. Removing a registration does not cancel its saved fee.

Old binaries cannot safely edit this config: upgrade all machines together. New readers reject unsupported config versions and malformed Account records instead of replacing them with defaults.

The dashboard, receipt and stats JSON prorate each relevant Account fee over the selected inclusive dates at `monthlyUsd / 30` per day. An unknown fee makes the combined fee and multiple unavailable. With a known zero fee, positive usage displays `∞ — all of it`; zero usage displays `—`.

## Publish Checklist

Before publishing externally, choose and record:

- Package name or npm scope.
- License.
- Public repository URL.
- Whether this directory becomes a standalone repo or a submodule of the focused workspace.

Do not run `npm publish`, create a GitHub repo, or edit `.gitmodules` until those choices are confirmed.
