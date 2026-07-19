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
machine. Because it is the last writer's view of a rolling 30-day window, the pooled cursor total
can wobble slightly between bursts as different machines republish it; that is expected. Cursor
usage reached through the local OpenCode bridge stays machine-scoped as normal. Because of the
account scope, creating or joining a pool with the Cursor Admin API enabled requires
`providers.cursor.email` to be set (Chaching refuses otherwise rather than mis-scope).

**Pool-wide double-count warning:** never bridge Cursor through OpenCode on one machine while any
machine in the pool polls the Cursor Admin API. The bridge attributes cursor spend per machine and
the Admin API attributes it to the shared account, so with both live *anywhere in the pool* the
same spend is counted twice pool-wide. Pick one path across the whole pool, not just per machine.

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

The aligned-burst design targets a serverless Postgres endpoint with scale-to-zero, such as
[Neon's Free plan](https://neon.com/pricing). To create a pool on Neon:

1. Create a Neon project and database. The default Free-plan compute range (0.25-2 CU) is ample.
2. In the project's **Connect** dialog, select the database and role, turn **Connection pooling
   off**, and copy the direct connection string. Chaching has only a few clients and performs its
   own transactional schema migrations, so the direct endpoint is the predictable choice; Neon's
   pooled PgBouncer endpoint is unnecessary here and is not recommended for generic migrations.
   See Neon's [connection-pooling guidance](https://neon.com/docs/connect/connection-pooling).
3. Keep the generated TLS query parameters, including `sslmode=require` and, when present,
   `channel_binding=require`. Store the complete URL in a password manager. Never commit it or put
   it directly in shell history.
4. On the first machine, expose the URL only for the create command and save the printed pool ID:

   ```sh
   read -rsp 'Neon URL: ' CHACHING_DATABASE_URL
   export CHACHING_DATABASE_URL
   chaching sync create --name 'Rai machines' --machine kinto
   unset CHACHING_DATABASE_URL
   ```

5. On every other machine, repeat the hidden `read` and join the printed pool ID:

   ```sh
   read -rsp 'Neon URL: ' CHACHING_DATABASE_URL
   export CHACHING_DATABASE_URL
   chaching sync join --pool '<pool-id>' --machine latios
   unset CHACHING_DATABASE_URL
   ```

   Use that machine's real name (`latios`, `nimbus`, and so on). Create/join stores the URL in
   that machine's mode-`0600` Chaching config, so the environment variable is no longer needed.

Use a direct URL whose hostname does **not** contain `-pooler`. The runtime opens a small local
client pool (`max: 4`) and closes idle one-shot connections; three machines do not need another
pooling layer. Neon requires TLS for all connections.

### Three-machine rollout checklist

Install the same Chaching version on all machines, then run one local scan before joining:

```sh
pnpm add -g chaching@latest
chaching doctor
chaching stats --no-art
```

Create the pool on one machine, join the other two, and verify all three appear:

```sh
chaching sync status --json | jq '{pool, machines, subscriptions, mappings}'
```

Each machine must actually run Chaching to publish its local aggregates. A long-running TUI or web
server publishes at `intervalMinutes`; a scheduled `chaching stats` run cold-scans, publishes once,
and exits. For laptops that are not running Chaching continuously, install a nightly scheduler on
every machine. Running all scheduled jobs at the same wall-clock time gives Neon a single wake
window and leaves each local SQLite ledger current even before subscription mappings are complete.
If `sync create` or `sync join` was run while a TUI/web server was already running, restart that
process once so it reloads the new pool identity and subscription mappings.

### Decide the subscription topology

Inventory subscriptions before adding them. For every provider used on every machine, record:

- the billing account or identity;
- the plan/tier and actual monthly USD cost;
- whether that exact paid subscription is shared with another machine;
- whether the provider is local-machine usage or a cloud-account feed.

Create one pool subscription row per **bill you pay**, not per machine. Map every
machine/provider pair using that bill to the same subscription ID. If Kinto and Latios both use the
same Claude Max account, create one Claude subscription and map both machines to it. If Nimbus uses
a separate Claude account, create a second subscription. Codex/ChatGPT follows the same rule.
OpenCode and Pi usage may need a custom or `$0` row depending on how their underlying models are
paid for; mappings are optional and do not affect token/cost aggregation itself.

Cursor Admin API is account-global and already deduplicated by configured account email. Use the
same `providers.cursor.email` on every machine polling the same account, and never mix that Admin
API feed with the Cursor-via-OpenCode bridge anywhere in the pool.

Mappings are retroactive read-time joins, so it is safe to create/join first and decide the billing
topology afterward. Remapping does not rewrite history.

For example, a pool where Kinto and Latios share one $200 Claude Max plan, Nimbus has a separate
$200 Claude Max plan, and all three share one Codex plan is configured from any joined machine:

```sh
chaching sync subscription add \
  --provider claude --name 'Work Claude Max' --account 'work-shared' \
  --tier max-20x --monthly-usd 200
chaching sync subscription add \
  --provider claude --name 'Nimbus Claude Max' --account 'nimbus-personal' \
  --tier max-20x --monthly-usd 200
chaching sync subscription add \
  --provider codex --name 'Shared Codex' --account 'shared' \
  --tier '<codex-tier>' --monthly-usd '<actual-monthly-usd>'

chaching sync status --json > /tmp/chaching-pool.json
WORK_CLAUDE_ID=$(jq -r '.subscriptions[] | select(.name == "Work Claude Max") | .id' /tmp/chaching-pool.json)
NIMBUS_CLAUDE_ID=$(jq -r '.subscriptions[] | select(.name == "Nimbus Claude Max") | .id' /tmp/chaching-pool.json)
CODEX_ID=$(jq -r '.subscriptions[] | select(.name == "Shared Codex") | .id' /tmp/chaching-pool.json)
KINTO_ID=$(jq -r '.machines[] | select(.name == "kinto") | .id' /tmp/chaching-pool.json)
LATIOS_ID=$(jq -r '.machines[] | select(.name == "latios") | .id' /tmp/chaching-pool.json)
NIMBUS_ID=$(jq -r '.machines[] | select(.name == "nimbus") | .id' /tmp/chaching-pool.json)

chaching sync map --machine "$KINTO_ID" --provider claude --subscription "$WORK_CLAUDE_ID"
chaching sync map --machine "$LATIOS_ID" --provider claude --subscription "$WORK_CLAUDE_ID"
chaching sync map --machine "$NIMBUS_ID" --provider claude --subscription "$NIMBUS_CLAUDE_ID"
chaching sync map --machine "$KINTO_ID" --provider codex --subscription "$CODEX_ID"
chaching sync map --machine "$LATIOS_ID" --provider codex --subscription "$CODEX_ID"
chaching sync map --machine "$NIMBUS_ID" --provider codex --subscription "$CODEX_ID"
rm -f /tmp/chaching-pool.json
```

The web controls appear only after this machine has created or joined the pool. They add pool-wide
subscription rows and map the current machine; the CLI's `--machine` option can manage all joined
machines centrally as shown above.

The arithmetic for a 3-machine, 24/7 pool at the default 15-minute interval:

- **Compute.** Neon free gives 100 CU-hours/month and scales to zero after 5 minutes idle at
  0.25 CU minimum. Aligned 15-minute bursts wake the endpoint ~4×/hour; each wake stays up for the
  ~5-minute idle floor, so ≈ 4 × 5.5 min ≈ 22 active min/hour ≈ 250 active hours/month × 0.25 CU
  ≈ **62 CU-hours/month against the 100 free.**
- **Storage.** Aggregates only, ~1-2 MB/month of growth against the **0.5 GB** cap.
- **Egress.** A few MB/month of aggregate reads, well inside the **5 GB** allowance.

The [5-minute scale-to-zero](https://neon.com/docs/introduction/scale-to-zero) is exactly what the
aligned grid exploits: because every machine bursts in the same window, the endpoint sleeps the
rest of the time. **Lowering the interval below ~10 minutes on a 3-machine pool defeats this**:
the wake windows start to overlap the idle floor and keep the endpoint awake continuously, which
blows the CU-hour budget. Keep the interval at 15 (or higher) on the free tier; only drop it if you
are on a paid plan or an always-on Postgres.

Note that dashboard loads also wake the endpoint *outside* the burst grid: opening the web
dashboard issues a sync-status read, which opens a PostgreSQL connection off-schedule. A dashboard
left open and frequently refreshed therefore adds wake windows the arithmetic above doesn't
account for, eroding the CU-hour budget. The status path is kept cheap (it no longer re-runs schema
DDL on every read), but the connection itself still wakes a scaled-to-zero endpoint.

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
