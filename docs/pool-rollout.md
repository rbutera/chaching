# Coordinated pool upgrade

This procedure upgrades schema 2, 3 or 4 to 5 using the same migration as Chaching. It affects **every pool in the database**. Do not start upgraded clients before backup, and do not start old clients against schema 5. No live rollout has been performed for PR 31.

The executable is [pool-rollout.mjs](pool-rollout.mjs), shipped in the npm package. It requires Node 24.16+, `tar`, and PostgreSQL `psql`, `pg_dump`, `pg_restore` on PATH. Use PostgreSQL tools matching the server major version. Automated recovery supports a dedicated Chaching database, with no application tables, functions or types outside `chaching_sync`. Use the same database role for backup and restore. Keep the existing database roles available so saved grants can be restored.

The commands do not stop or start remote processes. The roster is the operator's explicit attestation that every client is stopped and has the exact target artifact staged. Stop dashboard servers, MCP servers, background jobs and scheduled Chaching invocations on every registered machine. Disable automatic restarts for the maintenance window. Tokenmaxx itself does not need to stop.

## 1. Stage the exact artifacts and back up each client

Keep the exact old package for each machine and the target package locally. Identify them by SHA-256, not just version numbers. The target package must include the built web and CLI files. Install it into a separate directory without launching Chaching:

```sh
npm install --prefix "$TARGET_DIR" "$TARGET_TGZ"
TARGET_CLI="$TARGET_DIR/node_modules/chaching/bin/chaching.js"
ROLLOUT_SCRIPT="$TARGET_DIR/node_modules/chaching/docs/pool-rollout.mjs"
```

On **each stopped client**, run:

```sh
node "$ROLLOUT_SCRIPT" backup-client "$CLIENT_BACKUP" "$CONFIG_FILE" "$HISTORY_DB" "$OLD_TGZ"
```

Use absolute paths. `CONFIG_FILE` is the actual Chaching config, including any XDG override; `HISTORY_DB` is its configured history database, with `~` expanded. Use `-` instead of a history path only when history is disabled in config. The command copies the raw private config and old artifact and uses SQLite's backup API for history, including committed WAL data. It records the old config version and pool/machine identity. Backup files are private. Do not publish them or commit them to Git.

Copy each complete backup directory to the coordinator through your normal private transfer mechanism. Keep a copy on the original client. Do not edit `client.json` or move individual files out of its directory.

Create `roster.json` on the coordinator. It must contain exactly one entry for every `(pool_id,id)` returned by this read-only query, including dormant machines:

```sql
SELECT pool_id,id,name,hostname FROM chaching_sync.machine ORDER BY pool_id,id;
```

Each entry uses this format:

```json
[
  {
    "poolId": "pool-id-from-database",
    "machineId": "machine-id-from-database",
    "stopped": true,
    "targetSha256": "sha256-of-target-tgz-staged-on-this-machine",
    "backupManifest": "/private/backup/machine/client.json",
    "backupSha256": "sha256-of-that-client-json"
  }
]
```

Use `shasum -a 256 <file>` to obtain hashes. A machine that cannot be confirmed stopped is a rollout blocker. Do not remove it from the roster to bypass the check.

## 2. Preflight and database backup

Set `CHACHING_DATABASE_URL` securely in the environment. Never put credentials in a manifest or command argument. Standard PostgreSQL URLs are supported, including `sslmode`, `sslrootcert`, `sslcert` and `sslkey`; other URL options fail explicitly.

```sh
node "$ROLLOUT_SCRIPT" preflight "$ROLLOUT_DIR" "$ROSTER_FILE" "$TARGET_TGZ" "$TARGET_CLI"
node "$ROLLOUT_SCRIPT" backup "$ROLLOUT_DIR"
```

`ROLLOUT_DIR` must not already exist at preflight. Preflight verifies every client backup, the complete database roster, the target package hash and the target executable's agreement with the package. It records the original schema version and fingerprints of aggregate, session, quota, pool/machine, fee and non-null link rows. Null legacy links have no Account relationship and are deliberately omitted from the normalized comparison.

Backup creates a PostgreSQL custom-format dump of `chaching_sync`, checks that PostgreSQL can read it, verifies that data has not changed since preflight and records its checksum. Keep the directory intact. A failed backup does not authorize migration; preserve its evidence and begin a fresh preflight directory after fixing the cause.

## 3. Migrate and verify before restarting

```sh
node "$ROLLOUT_SCRIPT" migrate "$ROLLOUT_DIR"
node "$ROLLOUT_SCRIPT" verify "$ROLLOUT_DIR"
```

Migration calls `chaching sync schema --migrate --clients-stopped`. It does not start sync or publish usage. PostgreSQL applies the existing DDL in one transaction. Migration is repeatable with the same rollout directory. Both commands verify schema 5 and unchanged normalized row inventories. Changed fees, links, usage or machine membership fail verification instead of being accepted as the new baseline.

Only after verification succeeds, switch each stopped machine to the exact staged target artifact and restart the upgraded clients. Check `chaching doctor`, pool membership, Account fees, recent spend and quotas. Missing observations remain unavailable; Account spend filtering is intentionally unsupported. Preserve backups until the upgraded clients have been checked on every machine.

## 4. Recovery

Stop every upgraded client and disable restarts before recovery. Recovery replaces the entire `chaching_sync` schema with its backup. Usage published after the backup will be removed, so decide whether that data must be separately preserved before recovering after clients have restarted.

On the coordinator:

```sh
node "$ROLLOUT_SCRIPT" restore "$ROLLOUT_DIR" --clients-stopped
```

The dump checksum and original destination must match. The schema replacement runs in one PostgreSQL transaction. An SQL error rolls the replacement back. Success requires the original schema version and the original normalized row inventories. If restoration fails, keep clients stopped and resolve the reported database/tooling problem before retrying.

On each original client, using its original backup directory:

```sh
node "$ROLLOUT_SCRIPT" restore-client "$CLIENT_BACKUP" --clients-stopped
```

This verifies backup hashes, restores config/history to their recorded original paths and verifies the resulting bytes. A busy SQLite checkpoint fails. The command does not launch a binary. Restore the old installation from `old-package.tgz` in that backup directory, then start old clients only after database and local recovery both succeed. If a local restore is interrupted, keep that client stopped and rerun it. Config/history replacement is atomic per file, not across both files.

## Rehearsal

The integration test creates disposable schema-2 and schema-3 databases, performs backup, rejects changed fees, migrates twice, verifies, forces an SQL failure during recovery, confirms that failure rolls back, then restores schema/config/SQLite history. It drops only its generated test database and role.

```sh
CHACHING_TEST_PG_TOOLS=1 CHACHING_TEST_DATABASE_URL="$DISPOSABLE_ADMIN_URL" \
  pnpm exec nx run cli:test -- pool-rollout.integration.test.ts
```

The test database role needs CREATE DATABASE and CREATE ROLE. These permissions are for the disposable rehearsal; the production commands do not create databases or roles. PostgreSQL tools must be installed locally or supplied through PATH wrappers. Without both test environment variables, this optional tooling rehearsal is skipped; the ordinary migration integration suite remains separate.

Read-only inspection of the configured pool on 2026-09-11 found schema 2, three registered machines, one pool and no outside application objects. No identities, URLs, credentials or usage rows were exported. Schema 2 predates the quota-observation table; the comparison treats that absent table as empty and requires it to remain empty through migration. Both starting versions are rehearsed.
