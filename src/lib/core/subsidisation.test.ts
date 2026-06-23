import { describe, expect, it } from 'vitest';
import {
	buildSubsidisation,
	computeSubsidisation,
	fractionOfMonthElapsed,
	monthlyBurn,
	monthToDateRange,
	type ProviderSubsidisationConfig
} from './subsidisation';
import type { DayModelAgg } from '../types';

function agg(day: string, provider: string, model: string, cost: number): DayModelAgg {
	return {
		day,
		provider,
		model,
		tokens: { input: 0, output: 0, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost,
		costUnknownRequests: 0
	};
}

const enabled = (tier: string, monthlyUsd: number): ProviderSubsidisationConfig => ({
	enabled: true,
	tier,
	monthlyUsd
});

describe('computeSubsidisation', () => {
	it('computes the multiple and net subsidy for a paid tier', () => {
		const s = computeSubsidisation({ apiEquivalentUsd: 9633, monthlyUsd: 99 });
		expect(s.multiple).toBeCloseTo(9633 / 99, 6);
		expect(s.netSubsidyUsd).toBeCloseTo(9633 - 99, 6);
		expect(Math.round(s.multiple ?? 0)).toBe(97); // the "97×" headline
	});

	it('$0 Free tier yields a null multiple (no Infinity / NaN), full burn as net', () => {
		const s = computeSubsidisation({ apiEquivalentUsd: 4200, monthlyUsd: 0 });
		expect(s.multiple).toBeNull();
		expect(Number.isFinite(s.netSubsidyUsd)).toBe(true);
		expect(s.netSubsidyUsd).toBe(4200);
		expect(JSON.stringify(s)).not.toContain('Infinity');
		expect(JSON.stringify(s)).not.toContain('null,"netSubsidyUsd":NaN');
	});

	it('zero burn against a paid fee gives a 0 multiple (nothing used yet), negative net', () => {
		const s = computeSubsidisation({ apiEquivalentUsd: 0, monthlyUsd: 99 });
		expect(s.multiple).toBe(0);
		expect(s.netSubsidyUsd).toBe(-99);
	});

	it('negative net subsidy when fee exceeds value used (under-using)', () => {
		const s = computeSubsidisation({ apiEquivalentUsd: 40, monthlyUsd: 99 });
		expect(s.netSubsidyUsd).toBeLessThan(0);
		expect(s.multiple).toBeCloseTo(40 / 99, 6);
	});

	it('multiple scales inversely with fee for a fixed burn', () => {
		const a = computeSubsidisation({ apiEquivalentUsd: 1000, monthlyUsd: 100 });
		const b = computeSubsidisation({ apiEquivalentUsd: 1000, monthlyUsd: 200 });
		expect(a.multiple).toBe(10);
		expect(b.multiple).toBe(5);
		expect(a.multiple).not.toBe(b.multiple);
	});

	it('multiple scales with burn for a fixed fee', () => {
		const a = computeSubsidisation({ apiEquivalentUsd: 1000, monthlyUsd: 100 });
		const b = computeSubsidisation({ apiEquivalentUsd: 2000, monthlyUsd: 100 });
		expect(a.multiple).not.toBe(b.multiple);
		expect(b.multiple).toBe(2 * (a.multiple ?? 0));
	});
});

describe('monthly normalization (MTD + projected)', () => {
	it('fractionOfMonthElapsed is days-elapsed / days-in-month', () => {
		// 2026-06-15 → 15 / 30
		const f = fractionOfMonthElapsed(new Date('2026-06-15T12:00:00Z'));
		expect(f).toBeCloseTo(15 / 30, 6);
	});

	it('month-to-date range is the current calendar month so far', () => {
		const r = monthToDateRange(new Date('2026-06-15T12:00:00Z'));
		expect(r.from).toBe('2026-06-01');
		expect(r.to).toBe('2026-06-15');
	});

	it('projected = burnMTD / fractionElapsed (understated partial month scales up)', () => {
		const now = new Date('2026-06-15T12:00:00Z'); // half a 30-day month
		const m = monthlyBurn(300, now);
		expect(m.burnMTD).toBe(300);
		expect(m.burnProjected).toBeCloseTo(300 / (15 / 30), 6); // ≈ 600
	});
});

describe('buildSubsidisation roll-up', () => {
	const now = new Date('2026-06-15T12:00:00Z');
	// Two in-month rows: claude $200 MTD, codex $80 MTD. One out-of-month row ignored.
	const grain: DayModelAgg[] = [
		agg('2026-06-02', 'claude', 'claude-opus-4-8', 120),
		agg('2026-06-10', 'claude', 'claude-sonnet-4-6', 80),
		agg('2026-06-05', 'codex', 'gpt-5', 80),
		agg('2026-05-30', 'claude', 'claude-opus-4-8', 9999) // previous month, excluded
	];

	it('per-provider MTD burn is the current-month sum, projected scales up', () => {
		const r = buildSubsidisation(
			grain,
			{ claude: enabled('corporate', 99), codex: enabled('plus', 20) },
			now
		);
		const claude = r.providers.find((p) => p.provider === 'claude')!;
		const codex = r.providers.find((p) => p.provider === 'codex')!;
		expect(claude.monthly.burnMTD).toBe(200);
		expect(codex.monthly.burnMTD).toBe(80);
		expect(claude.mtd.multiple).toBeCloseTo(200 / 99, 6);
		expect(codex.mtd.multiple).toBeCloseTo(80 / 20, 6);
		// projection doubles a half-elapsed month
		expect(claude.projected.apiEquivalentUsd).toBeCloseTo(400, 6);
	});

	it('combined = Σ enabled burns / Σ enabled fees; Σ per-provider net == combined net', () => {
		const r = buildSubsidisation(
			grain,
			{ claude: enabled('corporate', 99), codex: enabled('plus', 20) },
			now
		);
		expect(r.combined.monthlyUsd).toBe(119);
		expect(r.combined.monthly.burnMTD).toBe(280);
		expect(r.combined.mtd.multiple).toBeCloseTo(280 / 119, 6);
		const sumNet = r.providers
			.filter((p) => p.enabled)
			.reduce((s, p) => s + p.mtd.netSubsidyUsd, 0);
		expect(sumNet).toBeCloseTo(r.combined.mtd.netSubsidyUsd, 6);
	});

	it('a disabled provider is excluded from the combined fee AND burn', () => {
		const r = buildSubsidisation(
			grain,
			{ claude: enabled('corporate', 99), codex: { enabled: false, tier: 'plus', monthlyUsd: 20 } },
			now
		);
		expect(r.combined.monthlyUsd).toBe(99); // codex fee excluded
		expect(r.combined.monthly.burnMTD).toBe(200); // codex burn excluded
		const codex = r.providers.find((p) => p.provider === 'codex')!;
		expect(codex.enabled).toBe(false);
	});

	it('$0 combined fee (both Free) yields a null combined multiple, no Infinity', () => {
		const r = buildSubsidisation(
			grain,
			{ claude: enabled('free', 0), codex: enabled('free', 0) },
			now
		);
		expect(r.combined.mtd.multiple).toBeNull();
		expect(JSON.stringify(r.combined)).not.toContain('Infinity');
	});
});
