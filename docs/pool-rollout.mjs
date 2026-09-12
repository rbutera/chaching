#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync, renameSync, unlinkSync, openSync, readSync, closeSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { DatabaseSync, backup } from 'node:sqlite';

process.umask(0o077);
const [phase, directory, ...args] = process.argv.slice(2);
const fail = message => { throw new Error(message); };
const hash = path => {
 const digest = createHash('sha256'), buffer = Buffer.alloc(64 * 1024), fd = openSync(path, 'r');
 try { let count; while ((count = readSync(fd, buffer, 0, buffer.length, null))) digest.update(buffer.subarray(0,count)); }
 finally { closeSync(fd); }
 return digest.digest('hex');
};
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
const equal = (a, b, label) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(`${label} changed; leave clients stopped.`); };
const checked = (path, expected) => { if (hash(path) !== expected) fail(`Checksum mismatch: ${path}`); };
const dir = directory && resolve(directory);

function pgEnvironment() {
 const url = new URL(process.env.CHACHING_DATABASE_URL || fail('Set CHACHING_DATABASE_URL.'));
 if (!['postgres:', 'postgresql:'].includes(url.protocol)) fail('Expected a PostgreSQL URL.');
 const env = { ...process.env, PGHOST: url.hostname, PGPORT: url.port || '5432', PGDATABASE: decodeURIComponent(url.pathname.slice(1)), PGUSER: decodeURIComponent(url.username), PGPASSWORD: decodeURIComponent(url.password), PGCONNECT_TIMEOUT: '10' };
 for (const [key, value] of url.searchParams) {
  if (!['sslmode', 'sslrootcert', 'sslcert', 'sslkey'].includes(key)) fail(`Unsupported database URL option: ${key}`);
  env['PG' + key.toUpperCase()] = value;
 }
 return env;
}
function run(command, argv, input) {
 try { return execFileSync(command, argv, { env: pgEnvironment(), input, encoding: 'utf8', maxBuffer: 128 * 1024 * 1024, stdio: ['pipe', 'pipe', 'pipe'] }); }
 catch (error) {
  if (dir && existsSync(dir) && error?.stderr) writeFileSync(join(dir, 'tool-error.log'), error.stderr, { mode: 0o600 });
  fail(`${command} failed. Clients must remain stopped; no success has been recorded. If the rollout directory exists, inspect its private tool-error.log.`);
 }
}
const sql = statement => run('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], statement).trim();
const version = () => Number(sql('SELECT version FROM chaching_sync.schema_version WHERE id=1;'));
const roster = () => JSON.parse(sql("SELECT coalesce(json_agg(x),'[]') FROM (SELECT pool_id,id FROM chaching_sync.machine) x;")).sort((a,b) => a.pool_id.localeCompare(b.pool_id) || a.id.localeCompare(b.id));
function baseline() {
 const v = version();
 if (![2, 3, 4, 5].includes(v)) fail(`Expected schema 2, 3, 4 or 5; found ${v}.`);
 const tables = ['pool', 'machine', 'machine_day_agg', 'machine_hour_agg', 'machine_session_agg', 'machine_provider_status'];
 const queries = Object.fromEntries(tables.map(table => [table, `SELECT * FROM chaching_sync.${table}`]));
 if (v < 5) queries.machine_day_agg = 'SELECT *, NULL::jsonb AS monetary FROM chaching_sync.machine_day_agg';
 if (v === 2 && sql("SELECT to_regclass('chaching_sync.machine_provider_status') IS NULL;") === 't') queries.machine_provider_status = 'SELECT 1 WHERE false';
 queries.accounts = `SELECT pool_id,id,provider,name,account,tier,monthly_usd,${v < 4 ? "NULL::text AS identity_key,'explicit'::text AS fee_source" : 'identity_key,fee_source'} FROM chaching_sync.${v < 4 ? 'subscription' : 'account'}`;
 queries.links = v < 4 ? 'SELECT pool_id,machine_id,provider,subscription_id AS account_id FROM chaching_sync.machine_subscription WHERE subscription_id IS NOT NULL' : 'SELECT pool_id,machine_id,provider,account_id FROM chaching_sync.machine_account';
 return Object.fromEntries(Object.entries(queries).map(([name, query]) => [name, sql(`SELECT count(*) || ':' || md5(coalesce(string_agg(row_to_json(x)::text, E'\\n' ORDER BY row_to_json(x)::text),'')) FROM (${query}) x;`)]));
}
function checkClients(manifest) {
 equal(roster(), manifest.clients.map(client => ({ pool_id: client.poolId, id: client.machineId })).sort((a,b) => a.pool_id.localeCompare(b.pool_id) || a.id.localeCompare(b.id)), 'Database client roster');
 for (const client of manifest.clients) {
  if (client.stopped !== true || client.targetSha256 !== manifest.targetSha256) fail('Every client must attest stopped and stage the same target artifact.');
  const path = resolve(client.backupManifest);
  checked(path, client.backupSha256);
  const saved = json(path);
  if (saved.poolId !== client.poolId || saved.machineId !== client.machineId) fail('Client backup identity does not match roster.');
  for (const file of saved.files) checked(resolve(path, '..', file.name), file.sha256);
 }
 checked(manifest.targetArtifact, manifest.targetSha256);
 checked(manifest.targetCli, manifest.targetCliSha256);
 checked(manifest.targetRuntime, manifest.targetRuntimeSha256);
}
function dedicatedDatabase() {
 const count = sql("SELECT count(*) FROM (SELECT relnamespace AS ns FROM pg_class UNION ALL SELECT pronamespace FROM pg_proc UNION ALL SELECT typnamespace FROM pg_type) objects JOIN pg_namespace n ON n.oid=objects.ns WHERE n.nspname NOT IN ('chaching_sync','information_schema') AND n.nspname NOT LIKE 'pg_%';");
 if (count !== '0') fail('Automated recovery requires a dedicated Chaching database with no other application relations.');
}

try {
 if (!dir) fail('Usage: node pool-rollout.mjs <backup-client|preflight|backup|migrate|verify|restore> <directory> [arguments]');
 if (phase === 'restore-client') {
  if (args[0] !== '--clients-stopped') fail('Stop this client before restoring its config/history.');
  const saved = json(join(dir, 'client.json'));
  for (const file of saved.files) checked(join(dir, file.name), file.sha256);
  for (const file of saved.files.filter(file => file.name !== 'old-package.tgz')) {
   if (file.name === 'history.db' && existsSync(file.source)) {
    const db = new DatabaseSync(file.source);
    try {
     const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
     if (result.busy) fail('History database is still in use.');
    } finally { db.close(); }
   }
   const temporary = file.source + '.rollout-restore';
   copyFileSync(join(dir, file.name), temporary); chmodSync(temporary, 0o600);
   renameSync(temporary, file.source);
   if (file.name === 'history.db') for (const suffix of ['-wal','-shm']) {
    if (existsSync(file.source + suffix)) unlinkSync(file.source + suffix);
   }
   checked(file.source, file.sha256);
  }
 } else if (phase === 'backup-client') {
  const [configPath, historyPath, oldArtifact] = args;
  if (!configPath || !historyPath || !oldArtifact) fail('backup-client requires config path, history path (or - when disabled), and old package artifact. Stop this client first.');
  mkdirSync(dir, { mode: 0o700 });
  const config = json(configPath);
  const files = [];
  for (const [source, name] of [[configPath, 'config.json'], [oldArtifact, 'old-package.tgz']]) {
   copyFileSync(source, join(dir, name)); chmodSync(join(dir, name), 0o600); files.push({ name, sha256: hash(join(dir,name)), source: resolve(source) });
  }
  if (historyPath !== '-') {
   const db = new DatabaseSync(historyPath, { readOnly: true });
   try { await backup(db, join(dir, 'history.db')); } finally { db.close(); }
   files.push({ name: 'history.db', sha256: hash(join(dir,'history.db')), source: resolve(historyPath) });
  } else if (config.history?.enabled !== false) fail('History backup may be omitted only when history is disabled.');
  save(join(dir, 'client.json'), { poolId: config.sync?.poolId, machineId: config.sync?.machineId, configVersion: config.version ?? 0, files });
 } else if (phase === 'preflight') {
  const [rosterPath, artifact, cli] = args;
  if (!rosterPath || !artifact || !cli) fail('preflight requires roster JSON, target package artifact and extracted target bin/chaching.js.');
  dedicatedDatabase();
  const originalSchema = version();
  if (![2, 3, 4].includes(originalSchema)) fail('Start a rollout from schema 2, 3 or 4; reuse its directory for reruns after migration.');
  const manifest = { schema: originalSchema, clients: json(rosterPath), targetArtifact: resolve(artifact), targetSha256: hash(artifact), targetCli: resolve(cli), targetCliSha256: hash(cli), targetRuntime: resolve(cli, '../../dist/cli/index.js'), targetRuntimeSha256: hash(resolve(cli, '../../dist/cli/index.js')), database: createHash('sha256').update(JSON.stringify([pgEnvironment().PGHOST, pgEnvironment().PGPORT, pgEnvironment().PGDATABASE])).digest('hex'), baseline: baseline() };
  for (const [entry, expected] of [['package/bin/chaching.js', manifest.targetCliSha256], ['package/dist/cli/index.js', manifest.targetRuntimeSha256]]) {
   const packed = execFileSync('tar', ['-xOf', artifact, entry], { maxBuffer: 128 * 1024 * 1024 });
   equal(createHash('sha256').update(packed).digest('hex'), expected, 'Extracted target executable');
  }
  checkClients(manifest);
  mkdirSync(dir, { mode: 0o700 });
  save(join(dir, 'rollout.json'), manifest);
 } else {
  if (!['backup','migrate','verify','restore'].includes(phase)) fail('Unknown rollout phase.');
  const manifest = json(join(dir, 'rollout.json'));
  equal(createHash('sha256').update(JSON.stringify([pgEnvironment().PGHOST, pgEnvironment().PGPORT, pgEnvironment().PGDATABASE])).digest('hex'), manifest.database, 'Database destination');
  checkClients(manifest);
  dedicatedDatabase();
  const dump = join(dir, 'pool.dump');
  if (phase === 'backup') {
   if (existsSync(dump)) fail('Backup already exists; preserve it and use the next phase.');
   equal(version(), manifest.schema, 'Pre-upgrade schema'); equal(baseline(), manifest.baseline, 'Pre-upgrade data');
   run('pg_dump', ['--format=custom', '--schema=chaching_sync', '--file=' + dump]);
   run('pg_restore', ['--list', dump]);
   equal(baseline(), manifest.baseline, 'Data during backup');
   save(join(dir, 'backup.json'), { sha256: hash(dump) });
  } else {
   checked(dump, json(join(dir, 'backup.json')).sha256);
   if (phase === 'migrate') {
    equal(baseline(), manifest.baseline, 'Data before migration');
    run(process.execPath, [manifest.targetCli, 'sync', 'schema', '--migrate', '--clients-stopped']);
   } else if (phase === 'restore') {
    if (args[0] !== '--clients-stopped') fail('Recovery requires --clients-stopped, including all upgraded clients.');
    const restoreSql = join(dir, 'restore.sql');
    run('pg_restore', ['--no-owner', '--file=' + restoreSql, dump]);
    run('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-c', 'DROP SCHEMA chaching_sync CASCADE;', '-f', restoreSql]);
   }
   equal(version(), phase === 'restore' ? manifest.schema : 5, 'Resulting schema');
   equal(baseline(), manifest.baseline, 'Aggregate, fee and link inventory');
  }
 }
 console.log(`${phase}: verified`);
} catch (error) {
 console.error(error instanceof Error ? error.message : 'Rollout failed.');
 process.exitCode = 1;
}
