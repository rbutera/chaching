# Dashboard production implementation plan

Status: ready to implement after the Account data dependencies below land. This is a visual refresh of production chaching, preserving its functionality. The prototype is a visual reference, not replacement application code.

## Sources and execution boundary

- [Accepted layout](https://github.com/rbutera/chaching/issues/18#issuecomment-5624607579)
- [Build rules and test contracts](https://github.com/rbutera/chaching/issues/19#issuecomment-5624624781), including the subsequent typography, recent-session and motion refinements
- [Account model](https://github.com/rbutera/chaching/issues/13#issuecomment-5621707669), [subsidisation](https://github.com/rbutera/chaching/issues/14#issuecomment-5622076956), [persistence](https://github.com/rbutera/chaching/issues/15#issuecomment-5622449115)
- Visual reference: `feat/dashboard-layout-prototype` at `4c25bdf`, `docs/prototypes/dashboard-layouts.md`.

Start from the production branch after the preceding model, monorepo, CI and Account work in the [2.0 map](https://github.com/rbutera/chaching/issues/2). Use a `feat/` implementation branch. Paths below are verified against production 1.18.0; relocate them to the agreed workspace paths after the monorepo migration. Do not merge the prototype branch wholesale or ship its fictional dates, accounts, settings actions or simplified data formatter.

Account-specific implementation depends on canonical Account IDs, fee history, machine/provider current-account selections and sanitised quota observations. The open attribution and Codex routing decisions remain upstream work: [attribution](https://github.com/rbutera/chaching/issues/28), [Codex routing](https://github.com/rbutera/chaching/issues/27), [pool upgrade](https://github.com/rbutera/chaching/issues/30). A closed design decision does not mean its data contract has been implemented. Do not invent Account attribution to make the dashboard render. Typography and shell work can begin independently; the complete dashboard cannot ship before those contracts are available.

## 1. Establish the production baseline

Run the existing tests/check/build before changes and capture any failures. Record real browser journeys for filters, date navigation, session search/sort/detail, receipts, provider configuration and sync. Inventory every currently reachable feature so relocation never becomes accidental deletion.

Retain cache breakdown, model mix, token classes, request counts, recent blocks, receipt/redaction actions, connection state, coverage states, keyboard navigation, cold-scan copy and existing personality. Place analytical detail in Explore or its existing detail sheet when it no longer belongs on the front page. The what-if calculator is the intentional feature removal; work/personal cutover and disclosure boxes remain excluded by earlier decisions.

Relevant baseline tests: `src/routes/page.test.ts`, `src/lib/components/SessionExplorer.test.ts`, `src/lib/components/DetailSheet.test.ts`, `src/lib/core/view-model.test.ts`, `src/lib/core/subsidisation.test.ts`, `src/routes/api/receipt.png/server.test.ts`, and sync/provider tests. Preserve behavioral assertions and migrate obsolete selectors as their owning UI changes, rather than disabling the suite in advance.

Exit: a feature-to-destination checklist and reproducible baseline results.

## 2. Resolve time, scope and shared accounting

Owners: `src/lib/core/view-model.ts`, `src/lib/client/dashboard.svelte.ts`, `src/lib/core/subsidisation.ts`, and their existing tests.

Extend the existing view state with the selected range endpoint and quota view. Keep a single Dashboard store and its existing preference persistence. Read older saved preferences safely; preserve filters and migrate renamed Account IDs using the Account migration contract. Default quota view is Current. Switching quota presentation must not change dates or filters.

Compute headline today/7d/30d/all-time values simultaneously with an explicit actual-UTC-today anchor. Resolve selected chart ranges separately: day, 7d, 30d, 90d, all. Add previous/next equal-window stepping, native date selection, day drilldown and return-to-latest using the current UTC date helpers. Remove prototype limits; use real available history. Refresh today's anchor across midnight without requiring reload.

Apply provider, machine, Account and existing model filters through shared derivations. Empty intersections remain empty. Preserve Coverage and unknown-cost semantics. The five-hour figure comes from the existing local active block, independent of pooled filters; its scope can be available in accessible context without visible "local" boilerplate.

Previous comparisons use identical filters and immediately preceding equal-length periods. Today-so-far compares with all of yesterday. Reuse `pctDelta` and the current positive-prior-spend baseline rule; no invented percentages for zero/unavailable prior spend or all-time totals. Display signed percentage alone, with baseline context in title/accessibility text. Keep current headlines and quota observations current during historical navigation.

Move pooled fee derivation out of `ValueBandRegion.svelte` into shared accounting, following the settled Account fee/history rules. Dashboard, receipt and stats outputs must agree for identical explicit dates and scope. Preserve the existing distinction between whole overlapping-session totals and clipped daily aggregates. Do not present project/session sums as exact daily reconciliation where the source cannot support it.

Exit tests: midnight/quiet today; day/month boundary stepping; historical range and current headline independence; disjoint comparison windows; zero/unavailable baselines; filter intersections; shared Account fee counted once; elapsed-hour averages; receipt/stats parity.

## 3. Build the shared dashboard shell and quotas

Owners: `src/routes/+page.svelte`, `CommandBar.svelte`, existing region components and `src/lib/client/sync.ts`. Introduce a focused quota region if needed; keep the data projection outside its markup.

Build compact Dashboard, Explore and Settings navigation. Keep one feed and configuration lifecycle across views. Preserve live/disconnected state. Avoid per-view reconnects or resetting the user's table state on a live update.

Dashboard order: large 5h/today/7d/30d/all-time amounts, scope/date controls, Spend charts, Account quotas, recent Sessions and subsidisation. Show the five most recent scoped sessions by last activity, with a View all action that carries scope into Explore. Keep session detail and receipt actions reachable.

Implement Current / All accounts / By provider as a remembered switch inside the quota section. Current is per machine/provider, not a fictional global Pool selection. Deduplicate Account rows across machines. Show short-term and weekly remaining percentages/reset times; retain observation age and unavailable states without invented capacity. Never sum quota percentages. Use one row renderer across views.

Exit tests: semantic region order; five most recent sessions; shared filters; three quota views and reload persistence; duplicate Account across machines; used-to-remaining conversion; missing quota windows; view switches preserving dates and scope.

## 4. Preserve Explore and Settings functionality

Explore owners: `SessionExplorer.svelte`, `DetailSheet.svelte`, `HeatmapRegion.svelte`, `ByModelRegion.svelte`, `ByProjectRegion.svelte`, `SessionsRegion.svelte`, and existing derivations.

Reuse the installed TanStack table and virtualization. Keep search/sort state across feed deltas. Offer spend ranking in Explore; table headers must sort with accessible direction indicators. Use bounded tables for models/projects as well, covering at least 12 models and 140 projects. Preserve day navigation, model filters, cache detail, token/request detail and session receipt actions. Clicking View all from the recent list initially preserves recency ordering; users can choose spend sorting.

Settings owners: `SyncPanel.svelte`, `src/routes/api/config/+server.ts`, `src/routes/api/sync/+server.ts`, and existing route handlers/client state.

Move real Account/fee configuration, machine and Pool operations into a carefully spaced Settings view. Reuse existing endpoints and validations, feedback and pending-state behavior. Preserve create/join/leave and feed restart/filter cleanup semantics. Never replace real operations with the prototype's "Sync now" status message. Changes must survive reload. Style existing personality/no-art and motion controls consistently; keep OS reduced-motion authoritative.

Exit tests: sorting/search/virtualization after live updates; cross-day detail; 100+ projects; keyboard access; Account edit success/failure; persisted settings; sync mutation failure; create/join/leave reconnect and filter cleanup. Verify the baseline feature checklist is fully accounted for.

## 5. Apply typography, motion and cleanup

Owners: `src/app.css`, `src/app.html`, `src/lib/components/ds/`, `src/lib/client/joy.ts`, `src/lib/client/motion.ts`, `src/lib/client/suppress.ts`, and the final route composition.

Use Space Grotesk for UI labels, captions, session names and numbers. Reserve monospace for code; use tabular figures for amount alignment. Update semantic typography tokens and their consumers instead of copying prototype CSS overrides. Keep existing personality tables; shorten headings to Spend, Sessions and Explore. Remove redundant "local", "Remaining allowance" and visible comparison prose.

Reuse MoneyOdometer/NumberFlow for changing numbers. Animate chart/bar dimensions from previous to next values. Preserve live-update throttling, final values and interruption behavior. Honor reduced-motion and no-art in JS and CSS; suppress all decorative remarks/emoji where required while keeping data and status visible. Reuse JoyController and clean up listeners/timers on unmount.

Adopt existing DS buttons, pills, badges and receipt lines where appropriate. Then delete only genuinely unused components/tests. Retired candidates are SummaryRail and HonestyFooterRegion; the five unused DS components are not an automatic deletion list. Remove WhatifRegion and exclusive dependencies after checking all callers, including API/CLI consumers. Fix stale theme-color using the default surface. Broader theme architecture stays in its later workstream; receipt PNG retains the default theme.

Exit: no obsolete routes/imports, no placeholder handlers, no prototype switcher/data, and all changed controls retain accessible names and keyboard focus. Verify ordinary UI text no longer inherits monospace.

## 6. Verify and prepare the implementation for review

Run `pnpm test`, `pnpm check`, `pnpm build` from the appropriate workspace after the migration. Run required Postgres integration checks with the repository's real test setup; do not treat skipped integration tests as passes. Build both web and CLI because shared derivations affect both. Inspect the package contents for prototype assets and accidental dependency changes.

Exercise production data in a browser at 1440x1000, 560x560 and 390x700. Check every baseline journey, all filters and quota views, date stepping and deltas, Settings writes, receipt export, no-art and reduced-motion. Inspect initial loading, unavailable/partial data, empty intersections and reconnects. Confirm no horizontal overflow, readable numbers, and charts followed directly by compact quotas. Change filters while animations run and confirm final displayed amounts match the selected data.

Prepare a draft PR with the behavior changes, screenshots at desktop/corner-window sizes, checks and any real limitations. Keep commits aligned with the steps above; each should leave working behavior and appropriate tests. Follow the map's release order and review process. Do not deploy, publish or merge as part of this plan.

Done means the production feature checklist is preserved, the intentional removals are explicit, and the accepted appearance works with real data. Passing the throwaway prototype's fixture tests is insufficient.
