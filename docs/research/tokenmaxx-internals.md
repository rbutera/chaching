# Tokenmaxx internals

Research for [#16](https://github.com/rbutera/chaching/issues/16) (child of #2). What chaching needs to know before it reads or reconciles against a tokenmaxx state DB.

**Sources.** Primary source is the tokenmaxx source itself, at `RubricLab/tokenmaxx` commit
[`6cd7172`](https://github.com/RubricLab/tokenmaxx/tree/6cd7172d828c6a0b8378168671a36e2013d7e179)
(`main` HEAD, package version `0.0.66`), cross-checked against the installed global package on this
machine (a symlink to a working clone at the same version). Line citations below are `file:line` at
that commit; permalinks take the form
`https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/<path>#L<n>`.
Live behaviour was checked read-only against `~/.tokenmaxx/state.sqlite` via `node:sqlite`
`DatabaseSync(path, { readOnly: true })`. No account identifiers, emails, tokens or credential
material appear here — only shapes and counts.

The README is not a reliable source for any of this; every claim below is traced to code.

---

## Schema, as built

`storage.ts:147-268` is the whole schema. The live DB on this machine matches it byte for byte
(same DDL text, same five tables, same six indexes), so there is no drift between the shipped
migration and what is on disk.

| Table | Key | Shape |
| --- | --- | --- |
| `accounts` | `id TEXT PRIMARY KEY` (internal UUID) | `provider, label, external_account_id, external_user_id, payload` |
| `usage_snapshots` | `account_id TEXT PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE` | `observed_at, payload` |
| `provider_states` | `provider TEXT PRIMARY KEY` | `payload` |
| `switch_records` | `id TEXT PRIMARY KEY` | `provider, created_at, payload` |
| `token_events` | *(no primary key, no foreign key)* | `at, provider, account_id, model, input_tokens, cache_read_tokens, output_tokens, cache_creation_tokens` |

Every table stores the interesting fields as a JSON `payload` validated by a Zod schema in
`domain.ts`; the promoted SQL columns exist only for indexing. `token_events` is the exception —
it is fully columnar and has no payload.

Two structural facts drive most of what follows:

- **`token_events` is the only time series.** `usage_snapshots` is keyed by `account_id` alone
  (`storage.ts:162-166`), so it holds exactly one row per account, overwritten on every probe
  (~60 s). Live: 2 accounts, 2 snapshot rows. There is no historical usage series to reconcile
  against.
- **`token_events` has no foreign key to `accounts`.** Rows survive the deletion of the account they
  point at (`storage.ts:182-190` vs. the `ON DELETE CASCADE` on `usage_snapshots`).

---

## 1. `token_events` retention and pruning

**31 days, pruned inline on every insert, never vacuumed.**

- The window is a single constant: `const maxTokenEventAgeMs = 31 * 24 * 60 * 60 * 1000`
  — [`src/storage.ts:25`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/storage.ts#L25).
- Pruning happens inside `recordTokenEvent`, immediately after the `INSERT`, on the same call:
  `database.query('DELETE FROM token_events WHERE at < ?').run(parsed.at - maxTokenEventAgeMs)`
  — [`src/storage.ts:524`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/storage.ts#L524)
  (function at `storage.ts:508-525`). This is the only `DELETE` against `token_events` outside of
  the migration wipe below.
- The retention window is deliberately matched to the longest dashboard timeframe: `TIMEFRAMES` tops
  out at `31d` (`domain.ts:230-236`). Retention exists to bound the chart, not to bound disk.

Four consequences that matter for reconciliation:

1. **Pruning is event-driven, not scheduled.** Nothing prunes on startup, on a timer, or on close.
   If no traffic flows through the proxy, rows older than 31 days simply persist. A DB from a
   machine that stopped being used still holds its last 31 days indefinitely.
2. **The cutoff is relative to the inserted event's own `at`, not to `Date.now()`.** In practice
   they coincide, because `at` *is* `Date.now()` at response completion (`proxy.ts:488`), but a
   backwards clock step would delete more than intended on the next write.
3. **No `VACUUM` anywhere in the source.** The file never shrinks after a prune.
4. **One historical full wipe.** The migration that added `cache_read_tokens` runs
   `database.exec('DELETE FROM token_events')` when that column is absent —
   [`src/storage.ts:209-212`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/storage.ts#L209-L212).
   Any DB predating that column lost all token history the first time it was opened by a newer
   build. A DB can therefore be older than its oldest `token_events` row for reasons unrelated to
   retention.

**Bound for chaching: at most 31 days of per-event token history, and only for traffic that was
actually proxied.** Live check on this machine: 50,071 rows spanning 13.04 days (oldest
`2026-08-28T13:06Z`, newest `2026-09-10T14:06Z`, i.e. the current instant). The DB is younger than
the window, so nothing has been pruned here yet — do not treat the observed span as the retention
limit.

---

## 2. Is OpenAI/Codex traffic metered? What controls it?

**Yes — into both tables, by design. Zero `openai` rows locally is configuration, not a gap.**

Metering path:

- The proxy routes exactly two prefixes: `pathname.match(/^\/(openai|anthropic)(\/.*)?$/)`
  — [`src/proxy.ts:287`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/proxy.ts#L287).
- The usage observer has a dedicated OpenAI branch that reads Responses-API shapes
  (`response.usage`, `input_tokens_details.cached_tokens`, and the legacy
  `prompt_tokens`/`completion_tokens`) at `proxy.ts:112-120`, and reports early the moment usage
  appears, because "the openai stream carries usage exactly once, in the terminal
  `response.completed` event… codex hangs up right after that event" (`proxy.ts:168-174`).
- The resulting event is recorded with `provider: route.provider`, i.e. `'openai'`
  (`proxy.ts:483-497` → `manager.ts:212` → `storage.recordTokenEvent`).
- `usage_snapshots` for OpenAI has **two** independent writers, distinguished by `source`
  (`domain.ts:111-114`, enum `codexUsageEndpoint | proxyResponseHeaders | apiKeyProbe`):
  polling `https://chatgpt.com/backend-api/wham/usage` on the 60 s `refreshAll` loop
  (`codex.ts:544`, `manager.ts:222-226`), and rate-limit headers observed on proxied responses
  (`manager.ts:555-575`).

What controls it is **not** a tokenmaxx setting — it is whether Codex itself is pointed at the
proxy. `installCodexConfig` writes into `$CODEX_HOME/config.toml` (default `~/.codex/config.toml`,
[`src/config-install.ts:19-21`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/config-install.ts#L19-L21)):

```toml
model_provider = "tokenmaxx"

[model_providers.tokenmaxx]
name = "tokenmaxx"
base_url = "http://127.0.0.1:8459/openai"
wire_api = "responses"
requires_openai_auth = true
```

— built at `config-install.ts:78-91`, written at `config-install.ts:93-101`. `installStatus()`
decides `codexRouted` by TOML-parsing the *selected* provider's `base_url` and checking for
`127.0.0.1` (`config-install.ts:187-204`). The Claude side is the mirror image: only
`ANTHROPIC_BASE_URL` is injected into `~/.claude/settings.json`, deliberately without an auth token,
since setting one would knock Claude Code off its claude.ai login (`config-install.ts:122-142`).

Verified locally, two independent reasons for zero `openai` rows:

- `~/.codex/config.toml` contains **no** occurrence of `tokenmaxx` and no top-level
  `model_provider = "tokenmaxx"` — Codex is not routed through the proxy at all.
- The state DB has **zero OpenAI accounts** (`accounts`: 2 anthropic, 0 openai). With no active
  OpenAI account, `upstreamInjection` returns `null` and the proxy answers `/openai` with a 503
  `no-active-account` before any upstream call (`manager.ts:168-175`, `proxy.ts:410-416`).

One further limitation worth recording: **tokenmaxx never reads Codex session logs.** There is no
read of `~/.codex/sessions/**` or any `.jsonl` anywhere in `src/`. A Codex run that bypasses the
proxy is invisible to tokenmaxx entirely, so chaching's own codex provider remains the only source
for un-proxied Codex spend, and the two are complementary rather than redundant.

---

## 3. Are `external_account_id` / `external_user_id` stable across re-login?

**Yes — and tokenmaxx enforces it. But `accounts.id` is not, and `accounts.id` is what the token
rows reference.**

Where the values come from:

- **Anthropic.** `externalAccountId` is the `uuid` returned by
  `GET https://api.anthropic.com/api/oauth/profile` (`claude.ts:48-62`, assigned at
  [`claude.ts:382`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/claude.ts#L382)).
  `externalUserId` is *always* `null` for anthropic — the discriminated union types it as `z.null()`
  (`domain.ts:50`). Live: 2/2 anthropic accounts carry a 36-character (UUID-shaped)
  `external_account_id`; 0 carry an `external_user_id`.
- **OpenAI.** Both come from the OAuth JWTs, with a documented fallback chain
  ([`codex.ts:107-134`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/codex.ts#L107-L134)):
  `externalAccountId = tokens.account_id ?? claims.chatgpt_account_id ?? claims['https://api.openai.com/auth'].chatgpt_account_id ?? accessClaims.chatgpt_account_id`
  (missing → `ACCOUNT_ID_MISSING`), and
  `externalUserId = claims.chatgpt_user_id ?? namespaced.chatgpt_user_id ?? namespaced.user_id ?? claims.sub`.

Stability is treated as an invariant and checked on every probe:

- Anthropic: `assertIdentity` throws `IDENTITY_CHANGED` — "Stored Claude credential belongs to a
  different account" — if the profile now returns a different account id
  (`claude.ts:721-731`).
- OpenAI: the same check runs twice, once for account and once for user
  (`codex.ts:676-687`).
- That error maps to health `reauthenticationRequired` (`manager.ts:117-125`).

So a re-login that lands on the same underlying account yields the same external ids and re-binds
cleanly; a re-login onto a *different* account is rejected rather than silently re-pointed. A token
refresh (as opposed to re-login) rewrites the external ids onto the same row from the refreshed
credential, which is a no-op in the stable case (`codex.ts:708-709`).

Uniqueness is enforced in SQLite, not just in code — partial unique indexes:

```sql
CREATE UNIQUE INDEX accounts_openai_external_user
  ON accounts(external_account_id, external_user_id)
  WHERE provider = 'openai' AND external_account_id IS NOT NULL AND external_user_id IS NOT NULL;
CREATE UNIQUE INDEX accounts_anthropic_external
  ON accounts(external_account_id)
  WHERE provider = 'anthropic' AND external_account_id IS NOT NULL;
CREATE UNIQUE INDEX accounts_provider_label ON accounts(provider, label);
```

— [`src/storage.ts:255-267`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/storage.ts#L255-L267);
`saveAccount` pre-checks the same triple and raises `DUPLICATE_ACCOUNT` before hitting the
constraint (`storage.ts:329-351`). Both indexes are present in the live DB.

**The caveat that matters for attribution.** `accounts.id` is a fresh `crypto.randomUUID()` minted
at registration (`claude.ts:374`, `codex.ts:185`), and it is what both `token_events.account_id` and
`usage_snapshots.account_id` hold — the proxy stamps `served.accountId`, the internal UUID
(`proxy.ts:484-487`). Removing and re-registering an account mints a *new* internal UUID;
`removeAccount` cascades the usage snapshot away, but `token_events` has no foreign key, so its rows
keep pointing at a UUID that no longer resolves.

> Join on `external_account_id` (+ `external_user_id` for openai) when identifying an account across
> time or across machines. Join on `accounts.id` only within a single DB snapshot, and expect
> orphaned `token_events.account_id` values.

---

## 4. `TOKENMAXX_HOME` and state paths on Linux / Windows

Everything derives from one function,
[`src/paths.ts:19-33`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/paths.ts#L19-L33):

```ts
const root = resolve(environment.TOKENMAXX_HOME ?? join(homedir(), '.tokenmaxx'))
```

| Path | Value |
| --- | --- |
| root | `$TOKENMAXX_HOME` or `~/.tokenmaxx` (`resolve()`d, so a relative value resolves against cwd) |
| database | `<root>/state.sqlite` |
| runtime dir | `<root>/runtime` |
| manager lock | `<root>/runtime/manager.lock` |
| manager socket | `<root>/runtime/manager.sock` |
| claude profiles | `<root>/profiles/claude` |
| preferences | `<root>/preferences.json` (`preferences.ts`) |
| heal stamp | `<root>/healed-version` (`config-install.ts:220`) |
| proxy port | `$TOKENMAXX_PROXY_PORT` or `8459`; a non-finite value falls back to `8459` |

Directories are created `0o700` and `chmod`ed back to `0o700` (`paths.ts:35-39`); the DB plus its
`-wal` and `-shm` are `chmod`ed `0o600` at open (`storage.ts:288-297`).

**There is no platform branching in the path logic.** No `XDG_DATA_HOME`, no `%APPDATA%` /
`LOCALAPPDATA`, no `process.platform` check anywhere in `src/` — the only `win32` test in the repo is
in `bin/launcher.cjs:16`, and it exists solely to pick `bun.exe` over `bun` when locating the
runtime. So:

- **Linux:** `~/.tokenmaxx/state.sqlite`.
- **Windows:** `%USERPROFILE%\.tokenmaxx\state.sqlite` (Node's `homedir()`).
- `TOKENMAXX_HOME` overrides the root on every platform.

**But tokenmaxx is macOS-only in practice, and chaching should assume the file is absent
off-macOS.** Two hard blockers:

- The only credential vault is `createMacOsKeychainVault()`, which shells out to `security`
  ([`src/vault.ts:89-152`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/vault.ts#L89-L152)),
  and it is the only vault constructed anywhere (`cli.ts:321,466,468,571,637`). No file, libsecret or
  DPAPI fallback exists. Without a vault, no account can be registered — and with no account, the
  proxy serves nothing and no `token_events` are ever written.
- The manager IPC channel is a Unix domain socket path with a `chmod 0o600` applied after `listen`
  (`ipc.ts:194-196`), which Windows named pipes would not accept.

The README badges the project "macOS" (`README.md:9`, `README.md:35`) and documents exactly three
env vars: `TOKENMAXX_HOME`, `TOKENMAXX_PROXY_PORT`, `TOKENMAXX_THEME` (`README.md:86`).

---

## 5. `switch_records` timestamp semantics

**One timestamp per row, stamped at commit, from the host wall clock. Every row is `committed`.**

Row shape: `id, provider, created_at TEXT, payload TEXT`, plus
`CREATE INDEX switch_records_provider_created ON switch_records(provider, created_at DESC)`
(`storage.ts:173-180`). The `created_at` column is written *from* `payload.createdAt`
(`storage.ts:466-473`), so column and payload cannot disagree — verified on all 13 live rows.

Payload schema (`domain.ts:199-213`): `createdAt`, `updatedAt` (both ISO-8601 datetime),
`generation` (positive int), `phase`, `provider`, `reason`, `sourceAccountId` (nullable),
`targetAccountId`. `phase` enumerates eight values —
`prepared | draining | synchronizing | activating | verifying | committed | rolledBack | failed`
(`domain.ts:188-197`).

**Seven of those eight are dead vocabulary.** The only writer is `Manager#commitActivation`
([`src/manager.ts:628-649`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/manager.ts#L628-L649)),
which stamps `const now = this.#dependencies.now().toISOString()` **once** and reuses it for
`createdAt`, `updatedAt`, *and* the provider state's `switchedAt`. It always sets
`phase: 'committed'`. `commitSwitch` then hard-rejects anything else — `phase !== 'committed'`, or a
provider / target / generation that disagrees with the state being written, raises
`INVALID_SWITCH_COMMIT` — and writes record and state in one `immediate()` transaction
(`storage.ts:475-495`). `saveSwitchRecord` is exported but has **no caller outside `storage.ts`**.

So the guarantee is: `createdAt === updatedAt` = the instant the switch was committed, i.e. *after*
the decision, and the row appears only if the switch actually took effect. There is no
partial/in-flight row to filter out and no rollback record to reconcile.

Verified live across 13 rows: 13/13 `phase = committed`; 13/13 `createdAt === updatedAt`; 13/13
column equals payload; `generation` runs 1…13 strictly monotonic; `reason` values observed are
`first-account`, `manual`, `automatic:threshold`, `automatic:hardLimit` (the `automatic:` prefix is
applied at `manager.ts:614`).

**Clock source.** `ManagerDependencies.now()`, defaulting to `() => new Date()`
(`manager.ts:107-116`) — the local host wall clock, injectable for tests. Not monotonic, not the
provider's clock, and unrelated to any upstream timestamp. `token_events.at` uses a *different* call
site — a bare `Date.now()` inside the proxy (`proxy.ts:488`) — but the same underlying clock, so the
two are directly comparable. An NTP step moves both.

**Attribution implication: you do not need `switch_records` to attribute tokens.** The proxy stamps
each event with the account it actually served (`served.accountId`, `proxy.ts:484-487`), so
`token_events.account_id` is already authoritative per event, including for a request that was
in flight across a switch. `switch_records` is useful only for explaining *why* the active account
changed. Because `created_at` is a fixed-width UTC `Z` string, the `DESC` index sorts correctly
lexicographically; `listSwitchRecords` defaults to `LIMIT 50` (`storage.ts:458-464`).

---

## 6. Plan-tier vocabulary, and any tier → price mapping

**The vocabulary is the providers', passed through unvalidated. There is no tier → price mapping
anywhere in the source.**

`plan` on an account is `z.string().trim().min(1).nullish()`
([`src/domain.ts:37`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/domain.ts#L37))
— free-form, no enum, no normalisation on write.

- **Anthropic** (`claude.ts:64-74`): prefer the credential's `rateLimitTier`, *but only if* it
  matches `/\d+x|max|pro|team|enterprise/i`; otherwise fall back to `subscriptionType`; otherwise
  `null`. Both fields are read straight out of the `claudeAiOauth` block of Claude Code's own
  credential file (`claude.ts:24-37`), so the strings are Anthropic's.
  **Live on this machine: both accounts carry `default_claude_max_20x`** — a `rateLimitTier` value
  (it matches both `max` and `20x`).
- **OpenAI** (`codex.ts:126`): `plan = claims['https://api.openai.com/auth'].chatgpt_plan_type`,
  taken from the id_token — OpenAI's vocabulary (`pro`, `plus`, …; fixtures use `'pro'`,
  `tui/fixtures.ts:331`).
- On re-probe the plan is refreshed but never cleared: `plan: <fresh> ?? account.plan ?? null`
  (`claude.ts:823`, `codex.ts:713`).

The only processing is cosmetic, in `planLabel` / `planTag`
([`src/tui/format.ts:313-337`](https://github.com/RubricLab/tokenmaxx/blob/6cd7172d828c6a0b8378168671a36e2013d7e179/src/tui/format.ts#L313-L337)):
lowercase; if the string contains `max`, render `Max <n>×` using the first `(\d+)\s*x` match;
otherwise Title-Case on `[\s_-]+`. `planTag` then strips spaces and `×`. So
`default_claude_max_20x` → `Max 20×` → tag `max20`, silently discarding the `default_claude_`
prefix; `pro` → `Pro`. Known strings therefore reduce to a `max`/non-`max` split plus a multiplier
digit — treat anything else as opaque.

**No plan → price map exists.** Every dollar figure in tokenmaxx comes from one of two places:

1. **A per-model rack-rate table**, `pricing.ts:8-57`, keyed by *substring* match on the model id
   with first-match-wins ordering: `claude-fable`, `claude-mythos`, `claude-opus-4-1`,
   `claude-opus-4-20`, `claude-opus`, `claude-sonnet`, `claude-haiku`, `gpt-5`, `o4`. Two traps for
   anyone tempted to reuse it:
   - **Unknown models silently fall back to Sonnet pricing** — `DEFAULT_PRICE` is
     `$3 / $15 / $0.30 / $3.75` per MTok (`pricing.ts:47-52`). Nothing is flagged. This is the
     direct opposite of chaching's cost-honesty rule (unknown → `null`), so tokenmaxx's cost
     column must not be trusted as an oracle.
   - The generic `claude-opus` entry (`$5 / $25`) sits *after* the two 4.1/4.20 entries
     (`$15 / $75`), so any opus id that is not literally `claude-opus-4-1` / `claude-opus-4-20`
     prices at the cheaper rate. Live data on this machine includes `claude-opus-5` (16,156 events)
     and `claude-fable-5-1`, both of which hit substring entries rather than exact ones.
2. **Provider-reported dollars for overage only** — `extraUsage`
   (`balanceUsd`/`limitUsd`/`spentUsd`/`usedPercent`, `domain.ts:95-105`) and usage windows of
   `kind: 'spend'` (`domain.ts:69-78`), parsed from Anthropic's `extra_usage` / `spend` money
   objects (`claude.ts:503-539`) and the Codex equivalent (`codex.ts:481`).

`UsageSnapshot.measuredSpendUsd` exists in the schema (`domain.ts:110`, `domain.ts:117`) but is
written `null` by both providers (`claude.ts:692`, `codex.ts:500`) — vestigial; do not read it.

**So the subscription fee a `max_20x` plan actually costs appears nowhere in tokenmaxx.** Its
"cost" is always a synthetic rack-rate valuation of proxied tokens, never what the user paid. If
chaching wants a subsidy figure it must supply the tier → fee mapping itself; tokenmaxx only
supplies the tier string.

---

## Summary for chaching

| Question | Answer |
| --- | --- |
| Reconciliation horizon | 31 days of `token_events`, pruned per-insert; `usage_snapshots` is current-state only, not a series |
| Codex coverage | Metered iff `~/.codex/config.toml` routes `model_provider = "tokenmaxx"` at `127.0.0.1/openai`; tokenmaxx never reads codex session logs |
| Stable join key | `external_account_id` (+ `external_user_id` for openai), enforced unique and re-checked on every probe; **not** `accounts.id` |
| Path off macOS | `$TOKENMAXX_HOME` else `~/.tokenmaxx/state.sqlite` on every platform, but expect no DB — the only vault is the macOS Keychain |
| Switch timestamps | Single wall-clock stamp at commit; every row `phase = committed`, `createdAt === updatedAt`; not needed for attribution |
| Plan tiers | Opaque provider strings (`default_claude_max_20x`, `pro`, …); no tier → price mapping exists |
