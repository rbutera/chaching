// Pure-render helpers for the `chaching whatif` human ledger. These are unit-tested
// directly (the subprocess smoke test can't assert structure over unpredictable
// local data): the window-wide actual is NOT among the ranked scenario rows (its
// scope differs from the included-only totals), and a nullable exclusion spend
// renders "spend unknown", never a fabricated $0 (types.ts:80 contract).

import { describe, expect, it } from 'vitest';
import { rankWindowScenarios, exclusionLine } from './commands/whatif';
import type { ScenarioResult, ScenarioExclusion } from '../lib/core/whatif/types';

function scenario(over: Partial<ScenarioResult> & Pick<ScenarioResult, 'id' | 'kind'>): ScenarioResult {
	return {
		id: over.id,
		kind: over.kind,
		label: over.label ?? over.id,
		basis: over.basis ?? 'basis',
		totalUsd: over.totalUsd ?? null,
		actualUsd: over.actualUsd ?? null,
		deltaUsd: over.deltaUsd ?? null,
		exclusions: over.exclusions ?? { modelCount: 0, models: [], spendUsd: 0 },
		notes: over.notes ?? []
	};
}

describe('rankWindowScenarios', () => {
	const results: ScenarioResult[] = [
		scenario({ id: 'no-cache', kind: 'no-cache', totalUsd: 210, actualUsd: 60, deltaUsd: 150 }),
		scenario({ id: 'alt-model:x', kind: 'alt-model', totalUsd: 42, actualUsd: 60, deltaUsd: -18 }),
		scenario({ id: 'alt-model:y', kind: 'alt-model', totalUsd: null }), // unavailable
		scenario({ id: 'plan-fit:codex', kind: 'plan-fit', totalUsd: null })
	];

	it('ranks only window scenarios cheapest-first with unavailable sinking to the bottom', () => {
		const ranked = rankWindowScenarios(results);
		expect(ranked.map((r) => r.id)).toEqual(['alt-model:x', 'no-cache', 'alt-model:y']);
	});

	it('never includes the plan-fit frame or a window-wide actual anchor row', () => {
		const ranked = rankWindowScenarios(results);
		expect(ranked.some((r) => r.kind === 'plan-fit')).toBe(false);
		// the only rows are real scenarios — no synthetic "actually billed" anchor
		expect(ranked.every((r) => r.id.startsWith('alt-model') || r.id === 'no-cache')).toBe(true);
	});
});

describe('exclusionLine', () => {
	it('renders nullable spend as "spend unknown", never $0', () => {
		const ex: ScenarioExclusion = { modelCount: 2, models: ['a', 'b'], spendUsd: null };
		const line = exclusionLine(ex);
		expect(line).toBe('2 model(s) excluded · spend unknown');
		expect(line).not.toContain('$0');
	});

	it('renders a known spend as a dollar figure', () => {
		const ex: ScenarioExclusion = { modelCount: 1, models: ['a'], spendUsd: 5 };
		expect(exclusionLine(ex)).toBe('1 model(s) excluded · $5.00');
	});

	it('returns null when nothing was excluded', () => {
		expect(exclusionLine({ modelCount: 0, models: [], spendUsd: 0 })).toBeNull();
	});
});
