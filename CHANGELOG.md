# Changelog

All notable changes to chaching. Follows [semver](https://semver.org/); dates are UTC.

## 1.9.0 — 2026-07-02

### Fixed

- **The period selector now re-scopes the whole dashboard.** Top model, the by-model donut, per-provider costs, the cache panel, and the cache-savings card were computed over all-time history regardless of the Day/Week/Month/Quarter selection (and of a pinned heatmap day). All of them now follow the same window as total spend and the trend chart. The cache hit-rate also no longer mixes an all-time numerator with a period-scoped denominator. The subscription-subsidy card is intentionally unchanged: it stays calendar month-to-date because it reconciles against a monthly fee.
- **Claude Fable 5 / Mythos 5 pricing in the web UI.** Server-side cost math was already correct ($10/$50 per MTok, $1 cache read, $12.50 cache write); the browser-side display resolver had no entry for the family, so the detail sheet and cache panel showed "price unknown" for every Fable 5 session. Both now price it, and `overrides.ts` carries exact-id entries as the documented safety net.

### Added

- **Codex and OpenCode stay live in long-running processes.** Previously only Claude Code logs were tailed and only Cursor polled its API — codex/opencode were read once at startup, so a dashboard left running overnight silently stopped counting new Codex sessions. The engine now re-polls them every 15 seconds: codex re-parses only mtime-fresh session files, opencode re-reads its database only when the db/-wal mtime moves, and the rollup dedup makes overlap free.

### Docs

- Deployment note: a subpath-mounted dashboard build must be produced with `CHACHING_BASE_PATH` (base path is baked at build time).
