# Changelog

All notable changes to chaching. Follows [semver](https://semver.org/); dates are UTC.

## Unreleased

### Added

- **Kimi K3 pricing** across Kimi/Moonshot, OpenCode Zen, and OpenCode Go at the published launch rates, including cached-input billing.
- **Chaching Sync** for opt-in multi-machine pools backed by PostgreSQL, with shared subscription mapping, CLI/wizard/web setup, and dashboard machine/subscription filters. Local SQLite remains the zero-config default. Each machine stays local-first and publishes compact day/hour/session **aggregates** — raw usage records never leave the machine. Subscription attribution is a read-time join (remaps are instant and retroactive), joining loses nothing, and leaving creates no local gap because local SQLite never stops recording.
- **`sync.intervalMinutes`** (`chaching sync interval <minutes>`, wizard prompt, default 15): a wall-clock-aligned publish cadence so all pool machines burst in one window and a serverless Postgres endpoint (e.g. Neon free tier) scales to zero between them. A 3-machine 24/7 pool at 15 min lands ≈62 of Neon's 100 free CU-hours/month; higher only makes peers' data staler, never your own. `chaching sync status` reports the interval and this machine's last-published time.

## 1.13.0 — 2026-07-11

### Added

- **GPT-5.6 Sol, Terra, and Luna pricing.** Codex usage now resolves each exact tier at its published standard, cached-input, and cache-write rates. Requests above 272K prompt tokens apply the full-request long-context multipliers, while unknown GPT-5.6 tier names remain explicitly unpriced instead of inheriting a generic GPT-5 rate.
- **All-time spend and projected annual burn.** The dashboard now shows cumulative lifetime spend and a yearly projection alongside the existing period-scoped views.

### Changed

- Refreshed the vendored LiteLLM and models.dev pricing catalogs and hardened browser/server pricing parity for GPT-5.6 and Claude Sonnet 5.
- Cache documentation now distinguishes observable cached reads from cache writes that Codex's local logs do not expose separately.

## 1.12.0 — 2026-07-02

### Changed

- **Days with no recorded data count as $0 — they no longer void comparisons.** The period delta on the dashboard hero, the month-over-month delta in `chaching wrapped`, and the burn-pace projection previously suppressed themselves if any day in the window lacked banked data. Quiet days (weekends, holidays, sick days) are evidence of zero spend, not lost data, so the recorded sums now compare as-is. The only remaining suppressions: a prior window with no recorded spend at all (a percentage of zero is meaningless), fewer than 3 elapsed days for the pace projection, and unknown-priced requests (which genuinely mis-state the arithmetic).

## 1.11.0 — 2026-07-02

### Changed

- **The subscription-subsidy card now follows the period selector.** The fee is pro-rated to the selected window from a daily rate of `monthly fee / 30`: the day view compares today's usage against fee/30, week against 7 days of fee, month (last 30 days) against the full monthly fee exactly, quarter against 90 days of fee; a pinned heatmap day is a 1-day window. The basis line names the window and the pro-rated fee. Shortfalls render as a plain net figure — the "(under-using)" verdicts, month-to-date projections, and "too early to call" states are gone. The receipt footer and `chaching wrapped` keep their calendar-month basis (they reconcile a specific month's bill).
- **The hero explains a missing period comparison** ("no full prior-window data yet", with a tooltip) instead of silently omitting the delta when the prior window contains days with no banked data.

## 1.10.1 — 2026-07-02

### Fixed

- **Subscription-subsidy card no longer passes judgment on a 2-day sample.** Early in a calendar month the card showed figures like "Codex $11.69 value · $0.00 (under-using)" beside rolling-30-day charts showing $224 — correct numbers, misleading framing. The basis line now names the window ("July so far · day 2 of 31"), verdicts ride the full-month projection ("on pace to earn it back · projected 0.9×" / "on pace to under-use") instead of the raw month-to-date, and with fewer than 3 elapsed days the card says "too early to call" rather than judging at all. The card stays calendar-month anchored by design — it reconciles against a monthly fee.

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
