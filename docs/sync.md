# Chaching Sync

Chaching Sync is an opt-in pooled ledger for people who use AI subscriptions across several
machines. Local mode stays the default. Joining a pool keeps every machine local-first — it still
reads its own Claude, Codex, OpenCode, Pi, and Cursor sources, dedupes them, and freezes completed
days into local SQLite — and additionally **publishes compact aggregates** to a shared PostgreSQL
database so the dashboard can show the whole pool.

## What is (and isn't) stored server-side

The pool stores **aggregates only**, never raw usage records:

- `machine_day_agg` — one row per machine × day × provider × model, upserted as a full replacement
  each burst (~100 rows/day pool-wide, versus thousands of raw records).
- `machine_hour_agg` — last-48h hour buckets (7-day server retention) so shared 5-hour cap windows
  can be reconstructed pool-wide.
- `machine_session_agg` — per-session summaries.
- pool / machine / subscription / mapping rows — the roster and attribution tables.

**Raw records never leave the machine.** Prompts, file paths, session contents, and per-request
rows all stay in local SQLite; only the rolled-up token/cost counts are published. That is a
privacy win as well as a bandwidth one.

## Mental model

A pool has three independent concepts:

- **Machines** are Chaching installations. Each install receives a stable random machine ID when
  it creates or joins a pool.
- **Subscriptions** are the plans you pay for, such as "Work Claude Max" or "Shared ChatGPT Pro."
  A subscription belongs to one provider and is charged once in pooled subsidy calculations.
- **Mappings** connect a provider on a machine to a subscription. Several machines can map to the
  same subscription. A machine can map Claude and Codex to different subscriptions.

Each machine's aggregates are namespaced by machine ID, so the same provider arriving from two
machines never collides, and a machine republishing its rows is an idempotent full-replacement
upsert. Subscription attribution is a **read-time join** on the mapping table: changing a mapping
takes effect instantly and retroactively, with no UPDATE sweep over historical rows.

Cursor Admin API spend is the exception: it describes a cloud-account fact every configured
machine would otherwise ingest. It is scoped to the account (`cursor-account:<email>`) with
last-writer-wins upserts, so every machine polling the same account computes identical aggregates
that collapse to one pool-wide row. It is shown as pool-global rather than attributed to a single
machine. Cursor usage reached through the local OpenCode bridge stays machine-scoped as normal.
Because of the account scope, creating or joining a pool with the Cursor Admin API enabled
requires `providers.cursor.email` to be set (Chaching refuses otherwise rather than mis-scope).

## Start PostgreSQL with Docker

The repository includes `docker-compose.sync.yml`.

```sh
export CHACHING_POSTGRES_PASSWORD='choose-a-long-random-password'

# Local-only database:
docker compose -f docker-compose.sync.yml up -d

# Or listen only on this host's Tailscale address for a tailnet pool:
export CHACHING_POSTGRES_BIND="$(tailscale ip -4)"
docker compose -f docker-compose.sync.yml up -d
```

The default connection URL is:

```text
postgresql://chaching:<password>@<postgres-host>:5432/chaching
```

Do not bind PostgreSQL to `0.0.0.0` on an untrusted network. The bundled setup supplies database
authentication, but Chaching Sync does not add a second application authentication layer. Use a
private network such as Tailscale, a firewall, a strong database password, and PostgreSQL TLS if
the connection leaves a trusted tailnet.

Back up the named Docker volume as you would any PostgreSQL database. Chaching creates and
migrates its `chaching_sync` schema automatically, but it does not manage database backups.

The schema requires PostgreSQL 15 or newer (it uses `ON DELETE SET NULL (column)` foreign keys);
the bundled compose file ships PostgreSQL 17.

## Create and join a pool

You can use the first-run wizard, the Sync panel at the bottom of the web dashboard, or the CLI.
For safety, web mutations are accepted only from a direct loopback client. A dashboard opened
through Tailscale Serve remains read-only for pool management; run the CLI on the host to change
its database connection or mappings.

On the machine hosting the pool:

```sh
read -rsp 'PostgreSQL URL: ' CHACHING_DATABASE_URL
export CHACHING_DATABASE_URL
chaching sync create \
  --name 'My machines' \
  --machine kinto
```

`create` prints the pool ID. On each additional machine, provide the same database URL
first (`join` requires it), then join:

```sh
read -rsp 'PostgreSQL URL: ' CHACHING_DATABASE_URL
export CHACHING_DATABASE_URL
chaching sync join \
  --pool '<pool-id>' \
  --machine nimbus
```

`CHACHING_DATABASE_URL` avoids putting the password in process arguments or shell history. The
CLI also accepts `--database-url` as an explicit override for automation environments where
argument visibility has already been handled.

Inspect the result:

```sh
chaching sync status
chaching sync status --json
```

The PostgreSQL URL is stored only in the local mode-`0600` Chaching config. It is excluded from
the web dashboard's public config API and from sync status output.

## Define subscriptions and mappings

Create each paid plan once:

```sh
chaching sync subscription add \
  --provider claude \
  --name 'Work Claude Max' \
  --account 'work@example.com' \
  --tier max-20x \
  --monthly-usd 200
```

Copy the subscription ID from `chaching sync status --json`, then map the current machine:

```sh
chaching sync map --provider claude --subscription '<subscription-id>'
```

Map another machine by its machine ID:

```sh
chaching sync map \
  --machine '<other-machine-id>' \
  --provider claude \
  --subscription '<subscription-id>'
```

Use `--subscription none` to clear a mapping. Because attribution is a read-time join, a remap is
instant and retroactive — no historical rows are rewritten. The web Sync panel exposes the same
operations with forms and selectors.

## The publish cadence (interval)

Each running Chaching instance publishes its aggregates on **wall-clock-aligned bursts**: at every
`intervalMinutes` grid instant (`:00/:15/:30/:45` for the default 15) plus a small random jitter.
All pool machines therefore fire in the *same* narrow window, so a serverless PostgreSQL endpoint
(see below) wakes once, absorbs the burst, and scales back to zero between windows.

Set the cadence per machine:

```sh
chaching sync interval 15    # default; >= 1
```

The wizard prompts for it during create/join. Higher = cheaper on serverless Postgres, because the
pool shares fewer wake windows. The only thing a larger interval affects is how stale **peers'**
data is on this machine — your own machine's numbers are always live (they come straight from the
local rollup, never a round-trip). `chaching sync status` shows the current interval and this
machine's last-published time.

## Runtime synchronization

Each running Chaching instance:

1. seeds the initial snapshot from its local rollup (frozen SQLite history ∪ live tail) merged with
   the pool's peer aggregates;
2. reads its local provider sources continuously (tail + poll), exactly as in local mode;
3. on each aligned burst, publishes its dirty day/hour/session aggregates (full-replacement
   upserts), heartbeats, and reads back peers' aggregates incrementally;
4. renders the pool as a read-time subscription join over local + peer rows.

The TUI, one-shot commands, and web server all use the same engine.

## Leaving a pool

```sh
chaching sync leave
```

Leaving forgets the stored database URL and returns this machine to local-only view. **There is no
local gap:** local SQLite kept recording and freezing the whole time this machine was pooled, so
its own history is fully intact. What you lose is visibility of the *other* pool machines' data,
until you rejoin. The machine ID is retained, so a later rejoin reuses the same identity.

## Serverless Postgres (Neon free tier)

The aligned-burst design targets a serverless Postgres endpoint with scale-to-zero, such as Neon's
free tier. The arithmetic for a 3-machine, 24/7 pool at the default 15-minute interval:

- **Compute.** Neon free gives 100 CU-hours/month and scales to zero after 5 minutes idle at
  0.25 CU minimum. Aligned 15-minute bursts wake the endpoint ~4×/hour; each wake stays up for the
  ~5-minute idle floor, so ≈ 4 × 5.5 min ≈ 22 active min/hour ≈ 250 active hours/month × 0.25 CU
  ≈ **62 CU-hours/month against the 100 free.**
- **Storage.** Aggregates only, ~1-2 MB/month of growth against the **512 MB** cap.
- **Egress.** A few MB/month of aggregate reads, well inside the **5 GB** allowance.

The 5-minute scale-to-zero is exactly what the aligned grid exploits: because every machine bursts
in the same window, the endpoint sleeps the rest of the time. **Lowering the interval below ~10
minutes on a 3-machine pool defeats this** — the wake windows start to overlap the idle floor and
keep the endpoint awake continuously, which blows the CU-hour budget. Keep the interval at 15 (or
higher) on the free tier; only drop it if you are on a paid plan or an always-on Postgres.

## Dashboard

When sync is enabled, the web dashboard shows:

- machine and subscription filter chips, which AND-compose with period, provider, and model
  filters;
- per-subscription value and fee accounting, counting a shared plan's fee once;
- the pool roster, last-seen timestamps, subscriptions, and machine/provider mappings;
- the publish interval and its serverless trade-off in the Sync panel.

Peers' data is at most `intervalMinutes` stale; the roster's last-seen timestamps show when each
machine last published. Five-hour cap windows fold peers in at **hour grain** (a pooled block is
approximate to the hour, while this machine's own contribution stays per-request exact), and are
hidden entirely while a machine or subscription filter is active — those windows carry no pool
attribution dimension.

## Troubleshooting

- `chaching sync status` reports PostgreSQL connection and pool identity errors, plus the current
  publish interval and this machine's last-published time.
- Confirm the database is listening on the expected Tailscale address, not only `127.0.0.1`.
- Confirm TCP port 5432 is allowed between the two tailnet devices.
- Run `docker compose -f docker-compose.sync.yml ps` and inspect PostgreSQL health.
- A failed burst is self-healing: the dirty aggregates are re-derived from the local rollup and
  republished on the next burst, so a transient PostgreSQL outage costs nothing but a little
  staleness in peers' view of this machine.
