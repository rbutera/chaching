# Dashboard production review

This branch implements the accepted dashboard design on the 1.18.0 production codebase. It also implements the approved Account identity, fee, and persistence prerequisites. It is a draft for review, not a release or live-pool upgrade.

## Appearance

Screenshots use an isolated local installation with synthetic transcripts, 140 projects, 12 models and a disposable PostgreSQL pool. They contain no real usage or private Account identities.

[Desktop, 1440 × 1000](desktop.png) · [Corner window, 560 × 560](corner.png) · [Narrow, 390 × 700](narrow.png)

The dashboard puts five-hour, today, seven-day, thirty-day and all-time figures above date/scope controls, Spend, Account quotas, five recent Sessions and subsidy details. Explore retains analytical tables, search, sorting, calendar, cache/token details and session detail. Settings contains appearance, sync, data and Account fees. Receipt export remains available in Dashboard and Explore.

## Verification

After the fee, preference and date-navigation fixes, `npm run check` reports zero errors and warnings, `npm run build` builds web and CLI, and `npm test` passes 1,125 tests across 98 files. PostgreSQL integration tests ran against a disposable PostgreSQL 15 instance using `CHACHING_TEST_DATABASE_URL`; none were skipped. This repository still uses its existing npm package layout, so the plan's future pnpm workspace commands do not apply yet.

Coverage includes populated schema-3 migration, rerun/concurrent migration and rollback, unchanged aggregate totals, old-client schema downgrade rejection, nullable/explicit fees, shared Account deduplication, private identity handling, interrupted manual creation retry, legacy CLI/API inputs, date-window and report parity, filters, recent sessions, quota observations, settings writes and motion preferences.

Browser evidence confirms no horizontal overflow at all three screenshot sizes; Explore searches a project/session among 140 projects, opens detail and closes it with Escape; animated totals settle to the dashboard amount. Saved screenshots capture the production app, not the throwaway prototype. Appearance and independent motion preferences survive reload; quota view switches and reload preserve dates. Backward navigation stops at the first window containing history. Native session detail keeps focus inside and restores it to the opening session button on close at narrow and desktop sizes. Table sorting/search runs without browser warnings. Period detail and its prior comparison apply the same provider/model/machine/Account filters as the chart; the model-filtered browser journey matches its bar and receipt scope. Synthetic peer filtering verifies $30 today against $20 yesterday (+50%, red), machine/Account intersections, empty intersections and receipt scope. Mixed-coverage weeks retain their bar with hatching and accurate gap wording. The browser journeys below are verified against the production build with isolated synthetic data.

## Remaining decisions and limitations

- [Account attribution #28](https://github.com/rbutera/chaching/issues/28) remains open. There is no invented historical login split. Current explicit mappings can label usage at read time. When several Accounts share unsplit usage, the value card can retain a combined known-set value while individual values remain unavailable. Selecting the complete known contributing Account set now retains the combined chart, session and receipt totals. A partial selection excludes unsplit usage from chart/export totals while the value card marks that allocation unavailable; deciding the partial-attribution presentation remains part of #28.
- [Codex routing #27](https://github.com/rbutera/chaching/issues/27) remains open. Missing quota observations remain unavailable. This branch does not alter routing or infer that missing metering means no paid Account.
- [Live pool rollout #30](https://github.com/rbutera/chaching/issues/30) remains open. Stop and upgrade old clients together; old binaries must not edit upgraded config or operate against the upgraded Account schema. No live migration has been performed.
- Local-only Account filters now use the canonical local roster and the same single-mapping attribution as pooled views. Snapshot and live deltas retain Account IDs; selected Account fees follow the same scope. Browser checks cover mapped spend, an unused Account with an unknown fee and persisted selection. Offline browser verification preserves selected pool IDs and restores their names on reconnect. While unreachable, labels fall back to IDs and the fee card says Pool unavailable; a cold offline process does not invent remote attribution or substitute local IDs/fees.
- Unresolved legacy matches now suppress affected pooled dashboard fees, matching the receipt/stats report path. Tests preserve unaffected provider fees and restore totals after resolution.
- Additional real browser checks cover pool offline/recovery, invalid join, successful join/create/leave, filter cleanup, retained local history, OS reduced motion and rapid filter changes with animations enabled. Keyboard calendar navigation (arrows, Home/End and Enter to pin) now also verifies provider/model scoped calendar amounts and matching receipt scope. Packaged provider add/disable/enable commands persist settings for all five providers; invalid provider input leaves config unchanged, and environment credentials are not written to config. No live provider credential or API was used. The baseline feature inventory is accounted for below.
- The accepted plan references later workspace/CI restructuring in the 2.0 map. This branch keeps the existing production layout; it does not implement unrelated monorepo work.

The approved web what-if calculator removal is intentional. CLI/API what-if remain. The excluded web work/personal cutover form is absent; existing configuration/CLI compatibility remains. No merge, deploy, publish or live-data migration is part of this change.

## Production feature inventory

Compared with production commit `6221826`, the existing route's reachable regions are retained or relocated as follows. The evidence is the current route composition and the passing named tests, supplemented by the browser journeys above.

| Production behavior | Final destination and verification |
| --- | --- |
| Periods, current/pinned spend, comparisons, date navigation and model/provider filters | Dashboard headlines and shared CommandBar; Explore hero and calendar. `view-model.test.ts` and `page.test.ts` cover quiet days, midnight, equal prior windows, baseline suppression, intersections and pinning. Browser date input and keyboard Home/End/arrows/Enter retain receipt scope. |
| Machine and Account scope | Shared compact native filter disclosures. Local and pooled snapshots/live deltas carry attribution. Complete known Account sets retain combined spend; partial attribution remains the decision described above. Browser populated/empty selections, disclosure keyboard access and offline selection retention verified. |
| Cache, token classes, request counts, averages and model mix | Dashboard CachePanel and Explore StatRowRegion/ByModelRegion. Existing derivation assertions remain; model/provider-scoped calendar and detail totals now match their scope. |
| Lifetime totals, recent blocks and five-hour spend | Explore LifetimeRegion and ByModelRegion retain these; Dashboard additionally shows the local active five-hour block independently of filters. No active block displays a dash. |
| Projects and sessions | Explore bounded TanStack tables retain search, sorting, virtualization and detail. Dashboard shows five recent sessions; View all preserves scope and restores recency sorting. Tested with 140 projects and 12 models, live updates and cross-day sessions. Native detail traps/restores keyboard focus. |
| Receipt and machine-readable reporting | Dashboard/Explore links preserve dates and all filters. CLI text/PNG/JSON receipts and stats use shared scope/fee derivations; receipt/stats and negative/unknown fee cases pass. Whole-session versus clipped day totals remain explicit. |
| Fees, provider setup, sync and data controls | Settings uses the real config/sync endpoints, including saved fees, failure feedback, manual Accounts and create/join/leave. Existing provider/init CLI paths remain; all five provider add/disable/enable commands were exercised in a disposable config. Existing cutover config/CLI compatibility remains; the excluded web form is absent. |
| Loading, coverage, disconnected and empty states | Existing feed and coverage paths retained. Mixed-coverage bars are hatched with gap wording; missing quotas and offline fees stay unavailable. Browser failure/recovery and empty intersections verified. |
| Typography, personality and motion | Space Grotesk UI with tabular amounts; monospace restricted to code. Existing remarks and JoyController retained. OS reduced motion, no-art, independent preferences, rapid changes and settled amounts verified. |
| Intentional removals | Web WhatifRegion and its exclusive test removed. CLI/API what-if remain. Unused SummaryRail and HonestyFooterRegion removed after caller checks; no baseline reachable route was lost. |

Final screenshots show the current implementation at all three required sizes. Machine/Account choices use bounded native disclosures so their roster size does not determine the command-bar height. Package inspection includes web and CLI output and excludes prototype/audit artifacts. This draft is ready for implementation review; the unresolved Account attribution, routing and coordinated rollout decisions above remain release blockers, not invented implementations.
