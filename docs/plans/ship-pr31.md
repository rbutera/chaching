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

Use existing PostgreSQL tooling and the existing migration entry point. Keep secrets out of manifests and command output. Rehearse against disposable populated schema-2 and schema-3 data, including failure/rollback and rerun, and make the runbook's commands directly runnable. No live data migration is authorized here.

## Completion evidence

| Requirement | Evidence |
| --- | --- |
| Investigate Tokenmaxx attribution | Source evidence above. No complete historical join exists; no weighting or fabricated split was introduced. |
| Remove the need for individual Account spend scope | Dashboard state/controls and saved Account filters removed. Combined value follows provider/model/machine/date scope. Per-Account rows show fees only. |
| Keep fees and quotas useful for Claude and Codex | Account identities, explicit/unknown fees, deduplication and setup remain. Selected identifies Tokenmaxx as its source; providers without a selection retain their quota rows. |
| Explicit report compatibility | CLI stats/receipt reject `--account` before output; receipt API returns HTTP 400 for Account scope. Supported provider/model/machine/date filters remain. |
| Cover the actual existing pool | Read-only inspection found schema 2, three machines, one pool and no outside application objects. No data or config was mutated. |
| Automatable coordinated rollout | `docs/pool-rollout.mjs` and `docs/pool-rollout.md` cover client backups, exact-roster preflight, database backup, existing migration invocation, verification and recovery. Operators attest stopped clients and staged artifacts; commands do not start remote processes. |
| Data-preserving recovery | `pool-rollout.integration.test.ts` rehearses populated schema 2 and 3, missing roster/corrupt backup/drift rejection, repeatable migration, failed restore rollback, schema/fee/link/aggregate preservation and config/SQLite recovery. |
| Gates and package | 1,134 tests across 99 files pass with PostgreSQL and PostgreSQL-tool rehearsals enabled. Type checks report zero errors/warnings; web/CLI build passes. Package includes rollout tooling and excludes audit/prototype artifacts. |
| Browser verification | Final screenshots come from the built production server against synthetic data at 1440x1000, 560x560 and 390x700. No horizontal overflow; no Account spend controls; receipt scopes and Explore tables remain. |
| Independent review | Bounded read-only GPT-6 reviews found no remaining implementation defects. A stale schema-3-only evidence note was corrected. The requested different-family reviewer reported GPT-6, so different-family review is not claimed. |

## Operational boundary

The schema command accepts versions 2, 3 and the current target 4. Preflight begins from 2 or 3 and records the original version for recovery. Schema 2 lacks the quota-observation table; the normalized inventory treats that absence as empty. The same original totals, fees and links must survive migration and recovery.

All migration/recovery execution was against disposable databases and client files. The existing pool was inspected only through a read-only PostgreSQL transaction. No merge, deployment, release or live migration is part of preparing PR 31.
