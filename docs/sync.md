# Chaching Sync

Chaching Sync is an opt-in shared PostgreSQL event ledger. The default remains local SQLite.
With sync enabled, every machine reads its own local provider logs, writes raw usage events
idempotently, and reads the pooled events from all joined machines.

## Network safety

Do not expose PostgreSQL to the public internet. Bind it to localhost plus a private network,
or to the host's Tailscale address, and restrict `pg_hba.conf`/the host firewall to your
tailnet. Use TLS when the connection can leave a trusted private host.

For a same-host development database:

```yaml
services:
  postgres:
    image: postgres:17
    restart: unless-stopped
    environment:
      POSTGRES_USER: chaching
      POSTGRES_PASSWORD: replace-this
      POSTGRES_DB: chaching
    volumes:
      - chaching-pg:/var/lib/postgresql/data
    ports:
      - "127.0.0.1:5432:5432"
volumes:
  chaching-pg:
```

For multiple machines, replace `127.0.0.1` with the server's Tailscale interface address,
not `0.0.0.0`, and allow only the tailnet clients that need access.

## Create or join a pool

```sh
chaching sync create \
  --database-url 'postgres://chaching:password@100.x.y.z:5432/chaching' \
  --name 'My team' \
  --machine 'work-mac'

chaching sync join \
  --database-url 'postgres://chaching:password@100.x.y.z:5432/chaching' \
  --pool '<pool-id-from-create>' \
  --machine 'home-linux'

chaching sync status
chaching sync status --json
```

The URL is written to the mode `0600` config and never included in public config or status.
The schema migration is idempotent. Each machine is identified separately, so identical
provider session ids and source keys on different machines cannot collide.

## Shared subscriptions

```sh
chaching sync subscription add \
  --provider claude \
  --name 'Work Claude' \
  --account 'me@example.com' \
  --tier corporate \
  --monthly-usd 99

chaching sync map --provider claude --subscription '<subscription-id>'
```

Mapping is per machine and provider. It attributes new raw events without changing computed
API-equivalent costs.

## Return to local mode

```sh
chaching sync leave
```

This clears sync credentials and identity from local config. The next run uses SQLite history.
It does not delete shared data.

## Existing SQLite history

Create/join does not import existing SQLite history. SQLite stores frozen aggregates, not the
raw events required by the sync ledger. Fabricating raw events from aggregates would lose
session, machine, and source-key provenance, so import is deliberately left as follow-up work.
Retained local provider logs are ingested normally and idempotently after sync starts.
