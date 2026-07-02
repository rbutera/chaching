# Changelog

All notable changes to chaching. Follows [semver](https://semver.org/); dates are UTC.

## 1.10.0 — 2026-07-02

### Added

- **By-project spend view** — which repo/client is eating the money, across all three faces: a "by project" panel on the web dashboard, a section in the TUI, and a "By project" block in `chaching stats`. Derived from whole sessions overlapping the selected window (labeled as such), grouped by normalized full path with a never-dropped "(unknown)" bucket, following the period selector and model/provider filters.
- **`chaching wrapped`** — a monthly recap in the thermal-receipt voice: total burn, top model, top project, cache savings, biggest single day, an honest month-over-month delta, and your subscription-subsidy multiple. `--month YYYY-MM` for past months, `--png` for a shareable image (same optional satori/resvg pipeline as the receipt), `--redact`, `--json`, `--no-art`. The month-over-month delta compares equal windows only — a month-to-date recap measures against the *same point* in the prior month, and the comparison is omitted entirely when either side isn't fully banked or contains unknown-priced spend.
- **`chaching doctor`** — one command that answers "why isn't provider X counting": per-provider config/source/freshness checks, latest-ingested vs newest-on-disk staleness hints (including the stale-long-running-process case), history-db health via a strictly read-only probe, and unknown-priced-model coverage. Exits non-zero on failures.
- **Burn-pace projection** — "on pace for ~$X this month" on the subscription-subsidy card. Calendar-month anchored (does not follow the period selector) and suppressed rather than fabricated: any missing-coverage day, fewer than 3 elapsed days, or unknown-priced requests in the window and the line simply doesn't render.
- **Version badge** in the web dashboard header, baked from package.json at build time.

### Fixed

- Display pricing for the gpt-5.2/5.3/5.4/5.5 point releases (each has its own rate; all previously displayed at base gpt-5 pricing) and for superseded Claude generations (Claude 3/4 Opus at $15/$75, Claude 3 Haiku at $0.25/$1.25 — previously shown at current post-price-cut family rates).
- A pricing **parity guard test** now cross-checks the browser display map against the server price sources (overrides + the vendored LiteLLM snapshot) for every Claude and OpenAI family, so a new model id failing to display-price breaks CI instead of shipping as "price unknown".

## 1.9.0 — 2026-07-02

### Fixed

- **The period selector now re-scopes the whole dashboard.** Top model, the by-model donut, per-provider costs, the cache panel, and the cache-savings card were computed over all-time history regardless of the Day/Week/Month/Quarter selection (and of a pinned heatmap day). All of them now follow the same window as total spend and the trend chart. The cache hit-rate also no longer mixes an all-time numerator with a period-scoped denominator. The subscription-subsidy card is intentionally unchanged: it stays calendar month-to-date because it reconciles against a monthly fee.
- **Claude Fable 5 / Mythos 5 pricing in the web UI.** Server-side cost math was already correct ($10/$50 per MTok, $1 cache read, $12.50 cache write); the browser-side display resolver had no entry for the family, so the detail sheet and cache panel showed "price unknown" for every Fable 5 session. Both now price it, and `overrides.ts` carries exact-id entries as the documented safety net.

### Added

- **Codex and OpenCode stay live in long-running processes.** Previously only Claude Code logs were tailed and only Cursor polled its API — codex/opencode were read once at startup, so a dashboard left running overnight silently stopped counting new Codex sessions. The engine now re-polls them every 15 seconds: codex re-parses only mtime-fresh session files, opencode re-reads its database only when the db/-wal mtime moves, and the rollup dedup makes overlap free.

### Docs

- Deployment note: a subpath-mounted dashboard build must be produced with `CHACHING_BASE_PATH` (base path is baked at build time).
