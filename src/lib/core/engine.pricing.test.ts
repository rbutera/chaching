import { createServer } from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { createEngine, runOnce } from './engine';
import type { chachingConfig } from './config';
import { getPricingCatalog, installPricingCatalog } from './pricing/cost';
import { mergeCatalogs, normalizeCatalog } from './pricing/catalog';
import type { RollupDelta } from '../types';

const originalCatalog = getPricingCatalog();
const roots: string[] = [];
afterEach(() => { installPricingCatalog(originalCatalog); vi.restoreAllMocks(); vi.unstubAllEnvs(); for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function config(root: string): chachingConfig {
	return { version: 1, accounts: [], providerAccounts: {}, cutoverTs: null,
		server: { host: '127.0.0.1', port: 5178, origin: '' }, history: { enabled: true, dbPath: join(root, 'history.db') }, tokenmaxx: { enabled: false, dbPath: '' },
		sync: { enabled: false, databaseUrl: '', poolId: null, machineId: null, machineName: '', intervalMinutes: 15 },
		providers: { claude: { enabled: true, roots: [root] }, codex: { enabled: false, root: '' }, cursor: { enabled: false, adminApiToken: '', email: null, pollSeconds: 3600 }, opencode: { enabled: false, dbPath: '' }, pi: { enabled: false, roots: [] } }
	};
}
function line(model: string, id: number) {
	return JSON.stringify({ type: 'assistant', timestamp: '2026-09-01T12:00:00Z', requestId: `req-${id}`, sessionId: 'session', message: { id: `message-${id}`, model, usage: { input_tokens: 1000, output_tokens: 1000, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 } } });
}
it('refreshes missing exact prices, sends a replacement, then preserves corrected and exact history after pruning and replay', async () => {
	vi.stubEnv('CHACHING_PRICING_REFRESH', '1');
	const root = mkdtempSync(join(tmpdir(), 'chaching-engine-pricing-')); roots.push(root);
	const dir = join(root, 'projects', '-project'); mkdirSync(dir, { recursive: true });
	const file = join(dir, 'transcript.jsonl'); const text = [line('claude-sonnet-future', 1), line('known-fixture', 2)].join('\n') + '\n'; writeFileSync(file, text);
	installPricingCatalog(mergeCatalogs('fixture', normalizeCatalog('modelsdev', { anthropic: { models: { 'claude-sonnet-4-6': { cost: { input: 10, output: 10 } }, 'known-fixture': { cost: { input: 3, output: 3 } } } } }, 'initial')));
	const payload = { 'claude-sonnet-future': { litellm_provider: 'anthropic', input_cost_per_token: 0.000001, output_cost_per_token: 0.000001 }, 'known-fixture': { litellm_provider: 'anthropic', input_cost_per_token: 0.001, output_cost_per_token: 0.001 } };
	const server = createServer((_req, res) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(payload)); });
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing fixture address');
	const nativeFetch = globalThis.fetch;
	vi.spyOn(globalThis, 'fetch').mockImplementation((_url, init) => nativeFetch(`http://127.0.0.1:${address.port}`, init));
	const engine = createEngine(config(root), () => Date.parse('2026-09-02T12:00Z'));
	const deltas: RollupDelta[] = []; engine.subscribe(delta => deltas.push(delta));
	try {
		await engine.ensureStarted(); const snapshot = engine.snapshot();
		expect(snapshot.totals.cost).toBeCloseTo(0.008, 8); expect(snapshot.totals.requests).toBe(2);
		expect(deltas.some(delta => delta.replace?.pricing && Math.abs(delta.replace.totals.cost - 0.008) < 1e-9)).toBe(true);
		engine.dispose(); rmSync(file);
		const pruned = await runOnce(config(root), () => Date.parse('2026-09-03T12:00Z'));
		expect(pruned.totals.cost).toBeCloseTo(snapshot.totals.cost, 10); expect(pruned.totals.tokens).toEqual(snapshot.totals.tokens); expect(pruned.totals.requests).toBe(snapshot.totals.requests); expect(pruned.sessions[0].cost).toBeCloseTo(0.008, 8);
		writeFileSync(file, text); const replay = await runOnce(config(root), () => Date.parse('2026-09-03T12:00Z'));
		expect(replay.totals.cost).toBeCloseTo(snapshot.totals.cost, 10); expect(replay.totals.tokens).toEqual(snapshot.totals.tokens); expect(replay.totals.requests).toBe(snapshot.totals.requests); expect(replay.dayModel.every(row => row.monetary)).toBe(true);
	} finally { engine.dispose(); server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
});

it('deduplicates current-day durable records after changing machine scope, including missing ids and CRLF source lines', async () => {
	vi.stubEnv('CHACHING_PRICING_REFRESH', '0');
	const root = mkdtempSync(join(tmpdir(), 'chaching-pricing-scope-')); roots.push(root);
	const dir = join(root, 'projects', '-project'); mkdirSync(dir, { recursive: true });
	const text = line('claude-sonnet-4-6', 1).replace('"id":"message-1",', '').replace('"requestId":"req-1",', '');
	writeFileSync(join(dir, 'transcript.jsonl'), text + '\r\n' + text + '\r\n');
	const now = () => Date.parse('2026-09-01T13:00Z');
	const cfg = config(root); const solo = await runOnce(cfg, now); expect(solo.totals.requests).toBe(2);
	const pooledConfig = { ...cfg, sync: { ...cfg.sync, enabled: true, poolId: 'fixture-pool', machineId: 'new-machine', databaseUrl: 'postgresql://fixture:fixture@127.0.0.1:1/fixture?connect_timeout=1' } };
	const pooled = await runOnce(pooledConfig, now);
	expect(pooled.totals.requests).toBe(2); expect(pooled.totals.tokens).toEqual(solo.totals.tokens); expect(pooled.totals.cost).toBeCloseTo(solo.totals.cost, 10);
	const backToSolo = await runOnce(cfg, now); expect(backToSolo.totals.requests).toBe(2);
	const replacement = text.replace('12:00:00', '12:01:00'); writeFileSync(join(dir, 'transcript.jsonl'), replacement + '\r\n' + replacement + '\r\n');
	const rewritten = await runOnce(cfg, now); expect(rewritten.totals.requests).toBe(4);
});
