import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { normalizeConfig } from '../../packages/core/src/config.ts';

export const now = Date.parse('2026-08-31T18:00:00Z');
export const month = '2026-08';
export function seedFixture(root: string, scale = 1) {
  const claude = join(root, 'claude');
  for (let day = 0; day < 365; day++) {
    if (day % 7 === 6) continue;
    const timestamp = new Date(now - day * 86400000).toISOString();
    const project = ['side-project', 'the-rewrite', 'one-small-fix'][day % 3];
    const directory = join(claude, 'projects', project);
    mkdirSync(directory, { recursive: true });
    const lines = Array.from({ length: 8 + (day * 17 % 37) }, (_, n) => JSON.stringify({
      type: 'assistant', timestamp, requestId: `req-${day}-${n}`, sessionId: `session-${day}`,
      cwd: `/projects/${project}`, isSidechain: n % 5 === 0,
      message: { id: `msg-${day}-${n}`, model: ['claude-opus-4-8', 'claude-sonnet-4-6', 'claude-haiku-4-5'][n % 3],
        usage: { input_tokens: Math.round((24000 + n * 2400) * scale), output_tokens: Math.round((18000 + n * 900) * scale),
          cache_creation_input_tokens: Math.round(240000 * scale), cache_read_input_tokens: Math.round((1200000 + day * 2000) * scale) } }
    }));
    writeFileSync(join(directory, `session-${day}.jsonl`), lines.join('\n') + '\n');
  }
  const db = new DatabaseSync(join(root, 'tokenmaxx.db'));
  db.exec('CREATE TABLE IF NOT EXISTS accounts (id TEXT, provider TEXT, payload TEXT); CREATE TABLE IF NOT EXISTS usage_snapshots (account_id TEXT, observed_at TEXT, payload TEXT); CREATE TABLE IF NOT EXISTS provider_states (payload TEXT); CREATE TABLE IF NOT EXISTS token_events (at INTEGER, provider TEXT, model TEXT, input_tokens INTEGER, output_tokens INTEGER, cache_read_tokens INTEGER, cache_creation_tokens INTEGER);');
  db.prepare('INSERT INTO accounts VALUES (?,?,?)').run('fictional-registration', 'anthropic', JSON.stringify({ plan: 'max20', externalAccountId: 'fictional-account' }));
  db.prepare('INSERT INTO usage_snapshots VALUES (?,?,?)').run('fictional-registration', new Date(now).toISOString(), JSON.stringify({ hardLimitReached: false, windows: [{ id: 'five_hour', label: '5h', usedPercent: 38, resetAt: '2026-08-31T21:00:00Z' }, { id: 'seven_day', label: '7d', usedPercent: 61, resetAt: '2026-09-04T18:00:00Z' }] }));
  db.prepare('INSERT INTO provider_states VALUES (?)').run(JSON.stringify({ provider: 'anthropic', activeAccountId: 'fictional-registration' }));
  for (const [id, provider, plan] of [['fictional-secondary', 'anthropic', 'pro'], ['fictional-codex', 'openai', 'plus']]) {
    db.prepare('INSERT INTO accounts VALUES (?,?,?)').run(id, provider, JSON.stringify({ plan, externalAccountId: id, externalUserId: provider === 'openai' ? 'fictional-user' : null }));
    db.prepare('INSERT INTO usage_snapshots VALUES (?,?,?)').run(id, new Date(now).toISOString(), JSON.stringify({ hardLimitReached: false, windows: [{ id: 'five_hour', label: '5h', usedPercent: 72, resetAt: '2026-08-31T21:00:00Z' }, { id: 'seven_day', label: '7d', usedPercent: 45, resetAt: '2026-09-04T18:00:00Z' }] }));
  }
  db.close();
  const config = normalizeConfig({
    version: 1,
    accounts: [{ id: 'fictional-claude', provider: 'claude', name: 'Claude Max', tier: 'max20',
      monthlyUsd: 200, feeSource: 'explicit', identity: { accountId: 'fictional-account', userId: null }, registrations: ['fictional-registration'], legacy: false },
      { id: 'fictional-secondary', provider: 'claude', name: 'Claude Pro', tier: 'pro', monthlyUsd: 20, feeSource: 'explicit', identity: { accountId: 'fictional-secondary', userId: null }, registrations: ['fictional-secondary'], legacy: false },
      { id: 'fictional-codex', provider: 'codex', name: 'Codex Plus', tier: 'plus', monthlyUsd: 20, feeSource: 'explicit', identity: { accountId: 'fictional-codex', userId: 'fictional-user' }, registrations: ['fictional-codex'], legacy: false }],
    providerAccounts: { claude: ['fictional-claude', 'fictional-secondary'], codex: ['fictional-codex'] },
    history: { enabled: false, dbPath: join(root, 'history.db') },
    tokenmaxx: { enabled: true, dbPath: join(root, 'tokenmaxx.db') },
    sync: { enabled: !!process.env.CHACHING_MARKETING_DATABASE_URL, databaseUrl: process.env.CHACHING_MARKETING_DATABASE_URL ?? '', machineName: 'Studio', poolId: '10000000-0000-4000-8000-000000000001', machineId: '10000000-0000-4000-8000-000000000002' },
    providers: { claude: { enabled: true, roots: [claude] },
      codex: { enabled: false, root: join(root, 'codex') },
      cursor: { enabled: false, adminApiToken: '' },
      opencode: { enabled: false, dbPath: join(root, 'opencode.db') }, pi: { enabled: false, roots: [] } }
  });
  mkdirSync(join(root, 'config', 'chaching'), { recursive: true });
  writeFileSync(join(root, 'config', 'chaching', 'config.json'), JSON.stringify(config, null, 2));
  return config;
}
