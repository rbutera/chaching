import { describe, expect, it } from 'vitest';
import {
	buildSubsidisation,
	burnPace,
	computeSubsidisation,
	fractionOfMonthElapsed,
	monthlyBurn,
	monthToDateRange,
	type ProviderSubsidisationConfig
} from './subsidisation';
import type { CoverageMap, DayModelAgg } from '../types';

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

describe('burnPace', () => {
	/** Every day in [from, to] inclusive (UTC), in-line so this test stays framework-free. */
	function daysInclusive(from: string, to: string): string[] {
		const out: string[] = [];
		for (let day = from; day <= to; ) {
			out.push(day);
			const d = new Date(day + 'T00:00:00Z');
			d.setUTCDate(d.getUTCDate() + 1);
			day = d.toISOString().slice(0, 10);
		}
		return out;
	}

	/** Full month-to-date coverage: frozen for every elapsed day except `now`'s day, which reads partial. */
	function fullMtdCoverage(now: Date): CoverageMap {
		const { from, to } = monthToDateRange(now);
		const map: CoverageMap = {};
		for (const day of daysInclusive(from, to)) map[day] = day === to ? 'partial' : 'frozen';
		return map;
	}

	/** Flat $10/day grain across [from, to], one row per day. */
	function dailyGrain(from: string, to: string, perDay: number): DayModelAgg[] {
		return daysInclusive(from, to).map((day) => agg(day, 'claude', 'claude-opus-4-8', perDay));
	}

	it('projects mtdCost / elapsedDays * daysInMonth for a clean mid-month sample', () => {
		const now = new Date('2026-06-15T12:00:00Z'); // 15th of a 30-day month
		const grain = dailyGrain('2026-06-01', '2026-06-15', 10); // 15 days x $10 = $150 MTD
		const p = burnPace(grain, fullMtdCoverage(now), now);
		expect(p).not.toBeNull();
		expect(p!.mtdCost).toBe(150);
		expect(p!.elapsedDays).toBe(15);
		expect(p!.daysInMonth).toBe(30);
		expect(p!.projectedCost).toBeCloseTo(300, 6); // 150 / 15 * 30
	});

	it('rows outside the current calendar month are excluded from mtdCost', () => {
		const now = new Date('2026-06-15T12:00:00Z');
		const grain = [
			...dailyGrain('2026-06-01', '2026-06-15', 10),
			agg('2026-05-30', 'claude', 'claude-opus-4-8', 9999) // previous month, must be ignored
		];
		const p = burnPace(grain, fullMtdCoverage(now), now);
		expect(p!.mtdCost).toBe(150);
	});

	it('honesty guard (a): a missing day inside the elapsed MTD range suppresses the projection', () => {
		const now = new Date('2026-06-15T12:00:00Z');
		const grain = dailyGrain('2026-06-01', '2026-06-15', 10);
		const coverage = fullMtdCoverage(now);
		delete coverage['2026-06-07']; // a gap the data layer has no opinion about -> missing
		expect(burnPace(grain, coverage, now)).toBeNull();
	});

	it("honesty guard (a): today reading 'partial' (the live tail) does NOT suppress", () => {
		const now = new Date('2026-06-15T12:00:00Z');
		const grain = dailyGrain('2026-06-01', '2026-06-15', 10);
		const coverage = fullMtdCoverage(now);
		expect(coverage['2026-06-15']).toBe('partial');
		expect(burnPace(grain, coverage, now)).not.toBeNull();
	});

	it('honesty guard (b): elapsedDays < 3 suppresses even with full coverage', () => {
		const day1 = new Date('2026-06-01T12:00:00Z');
		const day2 = new Date('2026-06-02T12:00:00Z');
		expect(burnPace(dailyGrain('2026-06-01', '2026-06-01', 10), fullMtdCoverage(day1), day1)).toBeNull();
		expect(burnPace(dailyGrain('2026-06-01', '2026-06-02', 10), fullMtdCoverage(day2), day2)).toBeNull();
	});

	it('month boundary: the 3rd of the month is the first day that renders', () => {
		const day3 = new Date('2026-06-03T12:00:00Z');
		const grain = dailyGrain('2026-06-01', '2026-06-03', 10); // $30 MTD over 3 days
		const p = burnPace(grain, fullMtdCoverage(day3), day3);
		expect(p).not.toBeNull();
		expect(p!.elapsedDays).toBe(3);
		expect(p!.projectedCost).toBeCloseTo(300, 6); // 30 / 3 * 30
	});

	it('handles a short (28-day February) month correctly', () => {
		const now = new Date('2027-02-14T12:00:00Z'); // 2027 is not a leap year
		const grain = dailyGrain('2027-02-01', '2027-02-14', 5); // 14 x $5 = $70 MTD
		const p = burnPace(grain, fullMtdCoverage(now), now);
		expect(p!.daysInMonth).toBe(28);
		expect(p!.projectedCost).toBeCloseTo(140, 6); // 70 / 14 * 28
	});
});
