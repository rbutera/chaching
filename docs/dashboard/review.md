# Dashboard production review

This branch implements the accepted dashboard design on the 1.18.0 production codebase. It also implements the approved Account identity, fee, and persistence prerequisites. It is a draft for review, not a release or live-pool upgrade.

## Appearance

Screenshots use an isolated local installation with synthetic transcripts, 140 projects, 12 models and a disposable PostgreSQL pool. They contain no real usage or private Account identities.

[Desktop, 1440 × 1000](desktop.png) · [Corner window, 560 × 560](corner.png) · [Narrow, 390 × 700](narrow.png)

The dashboard puts five-hour, today, seven-day, thirty-day and all-time figures above date/scope controls, Spend, Account quotas, five recent Sessions and subsidy details. Explore retains analytical tables, search, sorting, calendar, cache/token details and session detail. Settings contains appearance, sync, data and Account fees. Receipt export remains available in Dashboard and Explore.

## Verification

After the fee, preference and date-navigation fixes, `npm run check` reports zero errors and warnings, `npm run build` builds web and CLI, and `npm test` passes 1,125 tests across 99 files. PostgreSQL integration tests ran against a disposable PostgreSQL 15 instance using `CHACHING_TEST_DATABASE_URL`; none were skipped. This repository still uses its existing npm package layout, so the plan's future pnpm workspace commands do not apply yet.

Coverage includes populated schema-3 migration, rerun/concurrent migration and rollback, unchanged aggregate totals, old-client schema downgrade rejection, nullable/explicit fees, shared Account deduplication, private identity handling, interrupted manual creation retry, legacy CLI/API inputs, date-window and report parity, filters, recent sessions, quota observations, settings writes and motion preferences.

Browser evidence confirms no horizontal overflow at all three screenshot sizes; Explore searches a project/session among 140 projects, opens detail and closes it with Escape; animated totals settle to the dashboard amount. Saved screenshots capture the production app, not the throwaway prototype. Appearance and independent motion preferences survive reload; quota view switches and reload preserve dates. Backward navigation stops at the first window containing history. Native session detail keeps focus inside and restores it to the opening session button on close at narrow and desktop sizes. Table sorting/search runs without browser warnings. Period detail and its prior comparison apply the same provider/model/machine/Account filters as the chart; the model-filtered browser journey matches its bar and receipt scope. Synthetic peer filtering verifies $30 today against $20 yesterday (+50%, red), machine/Account intersections, empty intersections and receipt scope. Mixed-coverage weeks retain their bar with hatching and accurate gap wording. The complete browser journey audit is still in progress.

## Open work and decisions

- [Account attribution #28](https://github.com/rbutera/chaching/issues/28) remains open. There is no invented historical login split. Current explicit mappings can label usage at read time. When several Accounts share unsplit usage, the value card can retain a combined known-set value while individual values remain unavailable. Selecting the complete known contributing Account set now retains the combined chart, session and receipt totals. A partial selection excludes unsplit usage from chart/export totals while the value card marks that allocation unavailable; deciding the partial-attribution presentation remains part of #28.
- [Codex routing #27](https://github.com/rbutera/chaching/issues/27) remains open. Missing quota observations remain unavailable. This branch does not alter routing or infer that missing metering means no paid Account.
- [Live pool rollout #30](https://github.com/rbutera/chaching/issues/30) remains open. Stop and upgrade old clients together; old binaries must not edit upgraded config or operate against the upgraded Account schema. No live migration has been performed.
- Local-only Account filters now use the canonical local roster and the same single-mapping attribution as pooled views. Snapshot and live deltas retain Account IDs; selected Account fees follow the same scope. Browser checks cover mapped spend, an unused Account with an unknown fee and persisted selection. Offline browser verification preserves selected pool IDs and restores their names on reconnect. While unreachable, labels fall back to IDs and the fee card says Pool unavailable; a cold offline process does not invent remote attribution or substitute local IDs/fees.
- Unresolved legacy matches now suppress affected pooled dashboard fees, matching the receipt/stats report path. Tests preserve unaffected provider fees and restore totals after resolution.
- Additional real browser checks cover pool offline/recovery, invalid join, successful join/create/leave, filter cleanup, retained local history, OS reduced motion and rapid filter changes with animations enabled. The final feature and browser audit remains open for provider setup and keyboard calendar navigation; initial captures do not prove those journeys complete.
- The accepted plan references later workspace/CI restructuring in the 2.0 map. This branch keeps the existing production layout; it does not implement unrelated monorepo work.

The approved web what-if calculator removal is intentional. CLI/API what-if remain. Existing work/personal cutover configuration is retained to avoid an unapproved functionality loss. No merge, deploy, publish or live-data migration is part of this change.
