# chaching Configuration

chaching reads configuration from:

```sh
${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json
```

If the file is missing or malformed, chaching falls back to safe defaults:
Claude Code, Codex, and OpenCode local providers are enabled; Cursor Admin API is disabled.

Start from the example:

```sh
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/chaching"
cp config.example.json "${XDG_CONFIG_HOME:-$HOME/.config}/chaching/config.json"
```

## Server

```json
"server": {
	"host": "0.0.0.0",
	"port": 5178
}
```

The `chaching` CLI uses these values unless `HOST` or `PORT` is already set in the environment.

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

## Providers

### Claude Code

```json
"claude": {
	"enabled": true,
	"roots": ["~/.claude", "~/.config/claude"],
	"subscription": { "tier": "corporate", "monthlyUsd": 99 }
}
```

chaching scans `projects/**/*.jsonl` under each root. Claude Code logs are read-only and de-duplicated by message/request id. The optional `subscription` block drives the subsidisation card and receipt footer (see [Subscription subsidisation](#subscription-subsidisation) below).

### Codex

```json
"codex": {
	"enabled": true,
	"root": "~/.codex/sessions",
	"subscription": { "tier": "corporate", "monthlyUsd": 99 }
}
```

Codex usage is read from local JSONL session files. chaching uses `last_token_usage`, not cumulative totals, so repeated turn snapshots do not inflate spend. The optional `subscription` block drives the subsidisation card and receipt footer (see [Subscription subsidisation](#subscription-subsidisation) below).

### OpenCode

```json
"opencode": {
	"enabled": true,
	"dbPath": "~/.local/share/opencode/opencode.db"
}
```

OpenCode usage is read from the local OpenCode SQLite database (the `message` table) through Node's built-in `node:sqlite` module — one record per assistant message. chaching requires Node `>=24.16.0` for this provider. Because OpenCode reports `cost: 0` for Zen/Go/subscription usage, cost is computed from the vendored [models.dev](https://models.dev) price map (`static/pricing/modelsdev-prices.json`), not trusted; genuinely-free models price at `$0`, unpriced models are flagged unknown (never a faked `$0`).

Usage reached through the [opencode-cursor](https://github.com/Nomadcxx/opencode-cursor) bridge (tagged `providerID: cursor-acp` in the OpenCode DB) is attributed to the **Cursor** provider, not OpenCode — see below.

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

## Subscription subsidisation

The **Claude** and **Codex** providers each take an optional `subscription` block. It is purely a presentation input for the subsidisation card and receipt footer (the "how much API value did my flat fee buy me this month" framing). It never changes any cost computation.

```json
"subscription": {
	"tier": "corporate",
	"monthlyUsd": 99
}
```

- `tier` — a preset id (or `"custom"`). It is a free string; the dashboard switcher writes the preset id it selected.
- `monthlyUsd` — the flat monthly fee, in USD, that the API-equivalent burn is subsidised against. A non-negative finite number; `0` is allowed (Free tier → the subsidy multiple shows as "∞ — all of it" rather than dividing by zero).

**Defaults and backward compatibility.** The block is optional and additive. A config written before this feature (no `subscription`) loads unchanged and defaults each of Claude and Codex to **Corporate $99**. An invalid `monthlyUsd` (a string, negative, `NaN`) is clamped back to the default fee without error. `cursor` and `opencode` do **not** take a subscription block (they report real cost, so subsidisation does not apply).

**Presets** (the dashboard switcher offers these; the stored value is the resolved `{ tier, monthlyUsd }`, so a future preset price change never rewrites your saved fee):

| Provider | Presets |
|----------|---------|
| Claude | Free `$0` · Pro `$20` · Max 5× `$100` · Max 20× `$200` · Team Premium `$100` · Corporate `$99` · Custom |
| Codex | Free `$0` · Go `$8` · Plus `$20` · Pro 5× `$100` · Pro 20× `$200` · Corporate `$99` · Custom |

The dashboard tier switcher writes through to this file atomically at mode `0600`. You can also edit it by hand; chaching picks up the change on its next run.

## Publish Checklist

Before publishing externally, choose and record:

- Package name or npm scope.
- License.
- Public repository URL.
- Whether this directory becomes a standalone repo or a submodule of the focused workspace.

Do not run `npm publish`, create a GitHub repo, or edit `.gitmodules` until those choices are confirmed.
