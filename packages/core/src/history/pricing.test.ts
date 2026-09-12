import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { HistoryStore } from './store';
import { Rollup } from '../rollup/rollup';
import { normalizeCatalog, resolveValuation, type PricingCatalog } from '@chaching/shared/pricing/catalog';
import type { UsageRecord } from '@chaching/shared/types';

const roots: string[] = [];
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });
function catalog(model: string, price: number): PricingCatalog {
	return normalizeCatalog('modelsdev', { anthropic: { models: { [model]: { cost: { input: price, output: price } } } } }, String(price), true);
}
function record(key: string, model: string, prices: PricingCatalog): UsageRecord {
	const tokens = { input: 1000, output: 1000, cacheCreation: 0, cacheRead: 0 };
	const valuation = resolveValuation(prices, { provider: 'anthropic', model, tokens });
	return { key, provider: 'claude', billingProvider: 'anthropic', timestamp: Date.parse('2026-09-01T12:00Z'), day: '2026-09-01', sessionId: 'session', project: 'project', model, tokens, cacheCreation1h: 0, cacheCreation5m: 0, webSearchRequests: 0, webFetchRequests: 0, isSidechain: false, valuation, cost: valuation.cost };
}
function open() {
	const root = mkdtempSync(join(tmpdir(), 'chaching-valuation-')); roots.push(root);
	const path = join(root, 'history.db'); const store = new HistoryStore(); store.open(path); return { store, path };
}
it('retains current contributions, repairs down and up once, and recovers complete mixed hours after reopen', () => {
	const { store, path } = open();
	const estimated = record('estimated', 'claude-sonnet-future', catalog('claude-sonnet-4-6', 10));
	const missing = record('missing', 'unknown-new-model', catalog('unrelated', 1));
	const exact = record('exact', 'existing-model', catalog('existing-model', 3));
	expect(estimated.valuation?.kind).toBe('estimated'); expect(missing.cost).toBeNull();
	const original = [estimated, missing, exact]; const rollup = new Rollup();
	for (const row of original) { store.retainValuation(row); store.retainWrappedEvidence(row); rollup.add(row); }
	store.retainValuation(estimated); expect(store.loadValuations()).toHaveLength(3);
	const days = new Set(['2026-09-01']); const frozen = rollup.freezeCandidates(days); store.freezeDays(days, frozen.aggregates, frozen.sessions);
	const afterEstimate = record('estimated', estimated.model, catalog(estimated.model, 1));
	const afterMissing = record('missing', missing.model, catalog(missing.model, 2));
	const repairs = [{ before: estimated, after: afterEstimate }, { before: missing, after: afterMissing }];
	store.correctValuations(repairs); const generation = store.pendingPricingPublication();
	expect(generation).toBe(1);
	expect(() => store.correctValuations(repairs)).toThrow('Valuation changed');
	store.close();
	const reopened = new HistoryStore(); reopened.open(path);
	const recovered = new Rollup(); recovered.setFrozenDays(reopened.frozenDays()); recovered.loadAggregates(reopened.loadAggregates(), reopened.loadSessions()); recovered.restoreFrozenValuations(reopened.loadValuations());
	const snapshot = recovered.snapshot();
	expect(reopened.loadWrappedEvidence().flatMap(row => row.activity).reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(0.012);
	expect(snapshot.totals.cost).toBeCloseTo(0.012); expect(snapshot.totals.requests).toBe(3); expect(snapshot.totals.tokens).toEqual(rollup.snapshot().totals.tokens);
	expect(snapshot.totals.costUnknownRequests).toBe(0); expect(snapshot.sessions[0].cost).toBeCloseTo(0.012);
	expect(recovered.allHourAggregates(0).reduce((sum, row) => sum + row.cost, 0)).toBeCloseTo(0.012); expect(recovered.allHourAggregates(0).reduce((sum, row) => sum + row.requests, 0)).toBe(3);
	expect(reopened.loadValuations().find(row => row.key === 'exact')).toEqual(exact);
	const peer = new Rollup(); peer.loadAggregates(recovered.allDayAggregates(), recovered.allSessionSummaries());
	expect(peer.snapshot().dayModel.map(row => row.monetary)).toEqual(snapshot.dayModel.map(row => row.monetary));
	expect(peer.snapshot().sessions[0].monetary).toEqual(snapshot.sessions[0].monetary);
	expect(reopened.pendingPricingPublication()).toBe(generation);
	reopened.acknowledgePricingPublication(999); expect(reopened.pendingPricingPublication()).toBe(generation);
	reopened.acknowledgePricingPublication(1); expect(reopened.pendingPricingPublication()).toBeNull(); reopened.close();
});
it('does not infer repair eligibility for evidence-free legacy totals', () => {
	const { store } = open(); const rollup = new Rollup(); rollup.add(record('legacy', 'model', catalog('model', 20)));
	const days = new Set(['2026-09-01']); const frozen = rollup.freezeCandidates(days); store.freezeDays(days, frozen.aggregates, frozen.sessions);
	expect(store.loadValuations()).toEqual([]); store.correctValuations([]);
	expect(store.loadAggregates()[0].cost).toBe(0.04); expect(store.pendingPricingPublication()).toBeNull(); store.close();
});
