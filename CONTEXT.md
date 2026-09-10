# chaching

Local, multi-provider AI token-spend accounting for coding agents. One engine, several front-ends, no cloud.

## Language

### Spend and coverage

**Provider**:
A source of usage that chaching ingests: Claude Code, Codex, OpenCode, Pi, Cursor.
_Avoid_: vendor, integration, source

**Usage record**:
One priced unit of provider activity, de-duplicated by its key, that rolls up by day, provider and model.
_Avoid_: event, entry, row

**Cost**:
A computed estimate from tokens and per-token price. Unknown when the price is unknown; never zero by default.
_Avoid_: invoice, bill, price (price is the rate, cost is the result)

**Coverage**:
The trust state of one day's numbers: frozen, partial, missing, or zero.
_Avoid_: completeness, status

**Frozen day**:
A completed past day whose aggregates were snapshotted from a clean scan and will not change downward.
_Avoid_: archived, locked

### Money

**Subsidisation**:
API-rate usage value compared with Account fees for the same selected period, expressed as a multiplier and a dollar difference. Combined subsidisation counts each Account's fee once across machines.
_Avoid_: savings, discount, ROI

### Machines, accounts and pools

**Machine**:
One chaching install with a stable random id. Spend is attributed per machine.
_Avoid_: host, device, node

**Pool**:
A group of machines sharing aggregates through one Postgres store, so subsidisation can be reconciled across bills.
_Avoid_: team, sync group, fleet

**Account**:
One provider login together with its plan, quota windows and monthly fee. An account can be used on several machines, and a machine can use several accounts; its fee is counted once across those machines.
_Avoid_: subscription (a separate entity), profile, credential, user

**Tokenmaxxed machine**:
A machine where Tokenmaxx rotates several accounts behind a local proxy, so transcripts alone cannot say which account served a request.
_Avoid_: multi-account machine, pooled machine

**Reconcile (Tokenmaxx)**:
Correct a machine's per-day, per-model totals using Tokenmaxx's own token metering, which sees every proxied request.
_Avoid_: sync, merge, backfill

### Presentation

**Theme**:
The accent colour of the web dashboard. The surfaces always keep chaching's own Register & Receipt look; only the accent changes. The default is chaching's own accent; bundled alternates take their accent from One Dark Pro, GitHub (dark and light) and Catppuccin (Mocha and Latte).
_Avoid_: skin, palette (a theme is only the accent here), colour scheme (that is the OS light/dark signal)

**Receipt**:
The thermal-printer-style spend summary, in the terminal or as a PNG. It always renders in the default theme.
_Avoid_: report, summary, statement

**Redaction**:
Scrubbing user, host and path details from a receipt or export on request.
_Avoid_: anonymise, privacy mode
