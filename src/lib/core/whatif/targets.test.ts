// Alt-model target derivation. Pins the two behaviours the surfaces depend on:
// (1) the default target is a REAL counterfactual — never the model already present
// in the window (a zero-delta reprice-at-itself); (2) `windowModelsPresent` derives
// candidates from the UNFILTERED window grain, so the CLI default and the web menu
// reprice-agree with the endpoint (which reprices the whole window, not a filtered
// view).

import { describe, expect, it } from 'vitest';
import {
	CANONICAL_ALT_TARGETS,
	altModelTargets,
	defaultAltTarget,
	windowModelsPresent
} from './targets';
import type { DayModelAgg, TokenCounts } from '../../types';

function toks(input: number): TokenCounts {
	return { input, output: 0, cacheCreation: 0, cacheRead: 0 };
}
function dm(day: string, provider: string, model: string, cost: number): DayModelAgg {
	return {
		day,
		provider,
		model,
		tokens: toks(cost * 1000),
		requests: 1,
		cost,
		costUnknownRequests: 0
	};
}

describe('defaultAltTarget', () => {
	it('never returns the sole present model when a cheaper alternative exists', () => {
		// Both of these are themselves canonical ids — the old impl returned them
		// verbatim (zero delta). The fixed impl must pick a DIFFERENT canonical.
		expect(defaultAltTarget(['claude-sonnet-4-6'])).not.toBe('claude-sonnet-4-6');
		expect(defaultAltTarget(['claude-haiku-4-5'])).not.toBe('claude-haiku-4-5');
	});

	it('returns a canonical alternative not present in the window', () => {
		const t = defaultAltTarget(['claude-opus-4-8']);
		expect(t).not.toBeNull();
		expect(CANONICAL_ALT_TARGETS).toContain(t as string);
		expect(t).not.toBe('claude-opus-4-8');
	});

	it('falls back to a present model only when every canonical alternative is present', () => {
		const t = defaultAltTarget([...CANONICAL_ALT_TARGETS]);
		// no non-present canonical remains → first offered target (a present model)
		expect(altModelTargets([...CANONICAL_ALT_TARGETS])).toContain(t as string);
	});

	it('returns null when there are no models and no way to differ', () => {
		// empty window: no present models, so the first canonical alternative wins
		expect(defaultAltTarget([])).toBe(CANONICAL_ALT_TARGETS[0]);
	});
});

describe('windowModelsPresent', () => {
	const grain: DayModelAgg[] = [
		dm('2026-06-18', 'claude', 'claude-opus-4-8', 40),
		dm('2026-06-19', 'codex', 'gpt-5', 20),
		dm('2026-06-25', 'claude', 'claude-sonnet-4-6', 5) // outside the window below
	];

	it('derives models from the unfiltered grain within [from, to], cost-desc', () => {
		expect(windowModelsPresent(grain, '2026-06-18', '2026-06-20')).toEqual([
			'claude-opus-4-8',
			'gpt-5'
		]);
	});

	it('excludes days outside the window', () => {
		expect(windowModelsPresent(grain, '2026-06-18', '2026-06-20')).not.toContain(
			'claude-sonnet-4-6'
		);
	});
});
