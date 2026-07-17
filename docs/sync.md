# Chaching Sync

Chaching Sync is an opt-in pooled ledger for people who use AI subscriptions across several
machines. Local mode stays the default. Joining a pool switches durable history from the local
SQLite aggregate store to a shared PostgreSQL database while each machine continues reading its
own local Claude, Codex, OpenCode, Pi, and Cursor sources.

## Mental model

A pool has three independent concepts:

- **Machines** are Chaching installations. Each install receives a stable random machine ID when
  it creates or joins a pool.
- **Subscriptions** are the plans you pay for, such as "Work Claude Max" or "Shared ChatGPT Pro."
  A subscription belongs to one provider and is charged once in pooled subsidy calculations.
- **Mappings** connect a provider on a machine to a subscription. Several machines can map to the
  same subscription. A machine can map Claude and Codex to different subscriptions.

Every raw usage record is namespaced by machine ID. The same provider source key can therefore
arrive from two machines without colliding, while retries from one machine remain idempotent.
Changing a mapping also updates that machine's existing records for the provider, so dashboard
filters and pooled subscription accounting remain internally consistent.

Cursor Admin API events are the exception: they describe a cloud account event that every
configured machine would otherwise ingest. Their `cursor:*` source keys deduplicate pool-wide.
They are shown as pool-global rather than attributed to whichever machine won the insert race, so
an individual-machine filter excludes them. Cursor events reached through the local OpenCode
bridge remain machine-scoped.

Frozen Cursor aggregates cannot recover event IDs after SQLite has banked them. When the Cursor
provider has an `email` filter, migration uses that normalized account as the deduplication scope.
Two machines importing the same account therefore collapse safely, while different accounts stay
separate. Without an email filter, migration preserves machine scope rather than guessing and
risking data loss.

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

`create` prints the pool ID. On each additional machine:

```sh
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

Use `--subscription none` to clear a mapping. The web Sync panel exposes the same operations with
forms and selectors.

## Existing local history

When a machine creates or joins a pool, Chaching imports its existing frozen SQLite aggregates
and sessions into PostgreSQL before activating pooled mode. The local SQLite file is retained as
a rollback copy and is not modified or deleted.

Imported history is attributed to that machine. If you add a subscription mapping after joining,
the mapping is applied retroactively to imported aggregates and raw pooled records for that
machine and provider. The installation's machine ID is retained when it leaves, so interrupted
setup and deliberate rejoin attempts reuse one machine row and keep the import idempotent.

## Runtime synchronization

Each running Chaching instance:

1. loads pooled imported history and raw records for the initial snapshot;
2. scans its local provider sources;
3. tags new records with its machine and mapped subscription;
4. inserts them idempotently into PostgreSQL;
5. polls PostgreSQL every 15 seconds for records written by peers.

The TUI, one-shot commands, and web server all use the same engine. Leaving a pool restores the
local SQLite history backend:

```sh
chaching sync leave
```

## Dashboard

When sync is enabled, the web dashboard shows:

- machine and subscription filter chips, which AND-compose with period, provider, and model
  filters;
- per-subscription value and fee accounting, counting a shared plan's fee once;
- the pool roster, last-seen timestamps, subscriptions, and machine/provider mappings.

Five-hour cap windows are intentionally hidden while a machine or subscription filter is active.
Those windows come from provider-level activity and do not yet carry pool attribution.

## Troubleshooting

- `chaching sync status` reports PostgreSQL connection and pool identity errors.
- Confirm the database is listening on the expected Tailscale address, not only `127.0.0.1`.
- Confirm TCP port 5432 is allowed between the two tailnet devices.
- Run `docker compose -f docker-compose.sync.yml ps` and inspect PostgreSQL health.
- If the initial SQLite import reports a warning, the pool remains joined and live records still
  sync. Keep the SQLite file, repair access to it, then run `chaching sync import-history`. The
  import is idempotent for the current machine identity.
