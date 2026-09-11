# Ship PR 31

User direction: resolve attribution from Tokenmaxx where evidence supports it; otherwise simplify the product so individual Account spend filtering is unnecessary. Apply the same reasoning to Codex. Plan, document and automate the coordinated pool upgrade. Do not perform a live rollout as part of preparing it.

## Evidence inspected

Tokenmaxx source checkout `fe5f591`:

- `src/proxy.ts:482-499` records the Account that actually served a successful proxied response, including a retry that switched Accounts. Both Anthropic and OpenAI routes use this observer.
- `src/proxy.ts:168-174` records OpenAI usage at `response.completed`, handling clients that disconnect before stream flush.
- `src/storage.ts:182-191` stores timestamp, provider, registration ID, model and token counts. There is no transcript/session/request correlation key.
- `src/storage.ts:508-524` prunes events older than 31 days on insertion. Deleted registration identity cannot be recovered solely from the current Accounts table (`removeAccount`, lines 377-386).
- `src/config-install.ts:189-216` reads current client configuration, not historical per-request routing. Its loopback substring check is insufficient evidence that an arbitrary endpoint is Tokenmaxx.
- Read-only aggregate inspection of the default local database found retained Anthropic events and no OpenAI events. No identities, credentials or raw usage records were exported. Absence of events cannot establish absence of usage or a paid Account.

Proxy event Account attribution is useful evidence for those events. It cannot reliably divide all transcript-priced history among Accounts: events expire, unmatched old registrations exist in the general case, direct traffic is absent, and no exact transcript join exists. Weighting all spend by observed event shares would manufacture precision.

## Product decision

Spend remains authoritative at provider/model/machine/date scope. Remove individual Account selection from the web spend controls and discard saved web Account selections so they cannot silently hide usage. Retain Account identity, fees, manual setup, shared-fee deduplication, quota observations and machine links. Account rows need not claim an individually allocated transcript cost. The combined relevant provider/machine fee remains usable even when usage cannot be split among Accounts.

Quota selection represents Tokenmaxx's active selection at observation time. Do not call it proof of the Account used by an arbitrary Claude/Codex process. Preserve all observed Account quotas and unavailable states for both providers; do not change routing or infer no paid Account from absent OpenAI events. Keep the selected-account view useful with accurate source context and a usable fallback when no current selection is known.

Audit CLI/API Account scope compatibility explicitly: do not silently ignore a supplied Account filter or report an unknown allocation as a genuine zero. Keep historical aggregate totals unchanged.

## Pool rollout deliverable

Automate the existing migration rather than creating a second schema implementation. Provide separately executable preflight, backup, migrate, verify and recovery steps. Require an explicit roster of stopped/upgraded clients; record the old schema/config versions, exact target artifact and checksums, backups, immutable baseline totals and fee/link inventory. Back up the database and each machine's private config/history before migration. Compare the resulting totals and canonical fee/link inventory, then restart upgraded clients together. Recovery restores the matching old database/config/artifact set; never restart an old binary against upgraded state.

Use existing PostgreSQL tooling and the existing migration entry point. Keep secrets out of manifests and command output. Rehearse against disposable populated schema-3 data, including failure/rollback and rerun, and make the runbook's commands directly runnable. No live data migration is authorized here.

## Remaining implementation

1. Apply and test the spend/quota simplification, including saved preferences and report compatibility.
2. Implement the rollout commands, runbook and disposable rehearsal.
3. Re-run web/CLI/integration gates, browser journeys, package inspection and independent review; update PR 31 and its release-readiness evidence. Do not merge or release merely to demonstrate readiness.

## Implementation evidence

Individual web Account spend controls and Dashboard Account state are removed. The web ignores both saved `accounts` and legacy `subscriptions` selections, drops them on the next preference write, and no longer puts Account filters in receipt links. Provider, model, machine, date and quota-view preferences remain. Regression checks exercise both saved formats against ambiguous Account usage and preserve the real pinned-day total.

This checkpoint passes eight focused component tests, `npm run check` with zero errors/warnings, and the web/CLI build. Combined fee/value presentation, quota source wording/fallback, explicit CLI/API Account-scope handling and rollout automation remain pending. This is not shipping-readiness evidence for those remaining items.
