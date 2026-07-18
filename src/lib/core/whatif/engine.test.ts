import { describe, expect, it } from 'vitest';
import type { DayModelAgg } from '../../types';
import { computeCost } from '../pricing/cost';
import { buildScenarios } from './engine';

function agg(
	day: string,
	provider: string,
	model: string,
	tokens: DayModelAgg['tokens'],
	cost: number
): DayModelAgg {
	return { day, provider, model, tokens, requests: 1, cost, costUnknownRequests: 0 };
}

// Real Opus usage the engine can reprice against the real snapshot/overrides.
const OPUS_TOKENS = { input: 1_000_000, output: 500_000, cacheCreation: 200_000, cacheRead: 400_000 };
const opusDay = agg(
	'2026-07-10',
	'claude',
	'claude-opus-4-8',
	OPUS_TOKENS,
	computeCost('claude-opus-4-8', OPUS_TOKENS) ?? 0
);

describe('buildScenarios (engine wiring, real resolvers)', () => {
	it('reprices Opus usage at Sonnet and reports a real saving', () => {
		const results = buildScenarios([opusDay], {
			window: { from: '2026-07-01', to: '2026-07-31' },
			targetModel: 'claude-sonnet-4-6'
		});
		const alt = results.find((r) => r.kind === 'alt-model');
		expect(alt).toBeDefined();
		expect(alt!.actualUsd).toBeGreaterThan(0);
		expect(alt!.totalUsd).toBeGreaterThan(0);
		// Sonnet is cheaper than Opus per token → negative delta, no exclusions.
		expect(alt!.deltaUsd).toBeLessThan(0);
		expect(alt!.exclusions.modelCount).toBe(0);
		expect(alt!.notes[0]).toContain('Price-only counterfactual');
	});

	it('reprices Opus at a real OpenAI target via the default resolver (vendored snapshot)', () => {
		// gpt-5-codex resolves through the real cost.ts path (LiteLLM snapshot) with NO
		// cache-write price → the Anthropic→OpenAI cache-write fold fires on real data,
		// not an injected fake.
		const results = buildScenarios([opusDay], {
			window: { from: '2026-07-01', to: '2026-07-31' },
			targetModel: 'gpt-5-codex',
			planFit: false
		});
		const alt = results.find((r) => r.kind === 'alt-model')!;
		expect(alt.exclusions.modelCount).toBe(0);
		expect(alt.actualUsd!).toBeGreaterThan(0);
		expect(alt.totalUsd!).toBeGreaterThan(0);
		// 200k Opus cache-write tokens get folded to the target input rate.
		expect(alt.notes.some((n) => n.includes('cache-write tokens billed at its input rate'))).toBe(
			true
		);
	});

	it('no-cache delta is a non-negative saving on real Opus usage', () => {
		const [nc] = buildScenarios([opusDay], { targetModel: null, planFit: false });
		expect(nc.kind).toBe('no-cache');
		expect(nc.deltaUsd!).toBeGreaterThan(0);
		expect(nc.totalUsd!).toBeGreaterThan(nc.actualUsd!);
	});

	it('emits a plan-fit row per subsidised provider with usage in the window', () => {
		const results = buildScenarios([opusDay], {
			window: { from: '2026-07-01', to: '2026-07-31' },
			noCache: false
		});
		const planFit = results.filter((r) => r.kind === 'plan-fit');
		expect(planFit).toHaveLength(1); // only claude has usage here
		expect(planFit[0].id).toBe('plan-fit:claude');
		expect(planFit[0].notes.some((n) => n.includes('normalized'))).toBe(true);
	});

	it('excludes an unpriceable model from both sides of the alt-model reprice', () => {
		const mystery = agg(
			'2026-07-10',
			'claude',
			'totally-made-up-model-xyz-9000',
			OPUS_TOKENS,
			0
		);
		const results = buildScenarios([opusDay, mystery], {
			window: { from: '2026-07-01', to: '2026-07-31' },
			targetModel: 'claude-sonnet-4-6',
			planFit: false
		});
		const alt = results.find((r) => r.kind === 'alt-model')!;
		expect(alt.exclusions.models).toContain('claude/totally-made-up-model-xyz-9000');
		// Repricing only the known Opus slice gives the same totals.
		const solo = buildScenarios([opusDay], {
			window: { from: '2026-07-01', to: '2026-07-31' },
			targetModel: 'claude-sonnet-4-6',
			planFit: false
		}).find((r) => r.kind === 'alt-model')!;
		expect(alt.actualUsd).toBeCloseTo(solo.actualUsd!, 12);
		expect(alt.totalUsd).toBeCloseTo(solo.totalUsd!, 12);
	});
});
