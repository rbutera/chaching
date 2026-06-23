// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SubsidisationCard from './SubsidisationCard.svelte';
import { buildSubsidisation, type ProviderSubsidisationConfig } from '$lib/core/subsidisation';
import type { DayModelAgg } from '$lib/types';

const NOW = new Date('2026-06-15T12:00:00Z');

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

const grain: DayModelAgg[] = [
	agg('2026-06-05', 'claude', 'claude-opus-4-8', 9633),
	agg('2026-06-05', 'codex', 'gpt-5', 400)
];

function setup(claudeFee = 99, claudeTier = 'corporate') {
	const config = {
		claude: { enabled: true, tier: claudeTier, monthlyUsd: claudeFee },
		codex: { enabled: true, tier: 'plus', monthlyUsd: 20 }
	};
	const rollup = buildSubsidisation(grain, config, NOW);
	const onTierChange = vi.fn();
	render(SubsidisationCard, { rollup, config, onTierChange });
	return { onTierChange };
}

describe('SubsidisationCard', () => {
	it('renders the combined multiple headline', () => {
		setup();
		// combined burn 10,033 / fee 119 ≈ 84×
		expect(screen.getByLabelText('combined subsidy multiple').textContent).toContain('×');
	});

	it('shows the $0 Free tier as "∞ — all of it" (no Infinity/NaN)', () => {
		const config = {
			claude: enabled('free', 0),
			codex: enabled('free', 0)
		};
		const rollup = buildSubsidisation(grain, config, NOW);
		render(SubsidisationCard, { rollup, config, onTierChange: vi.fn() });
		expect(screen.getByLabelText('combined subsidy multiple').textContent).toContain('∞');
		expect(document.body.textContent).not.toContain('Infinity');
		expect(document.body.textContent).not.toContain('NaN');
	});

	it('shows "under-using your plan" when the fee exceeds the burn', () => {
		// huge fees so the small per-provider burns can't cover them
		const config = {
			claude: enabled('custom', 100000),
			codex: enabled('custom', 100000)
		};
		const rollup = buildSubsidisation(grain, config, NOW);
		render(SubsidisationCard, { rollup, config, onTierChange: vi.fn() });
		expect(document.body.textContent).toContain('under-using your plan');
	});

	it('selecting a preset emits onTierChange with the preset id + fee', async () => {
		const user = userEvent.setup();
		const { onTierChange } = setup();
		// the Claude switcher
		const select = screen.getByLabelText('Claude plan') as HTMLSelectElement;
		await user.selectOptions(select, 'max-5x');
		expect(onTierChange).toHaveBeenCalledWith('claude', 'max-5x', 100);
	});

	it('selecting Custom reveals the amount input and commits the typed value', async () => {
		const user = userEvent.setup();
		// start already on custom so the input is shown (seed 250)
		const { onTierChange } = setup(250, 'custom');
		const input = screen.getByLabelText('Claude custom monthly fee in USD') as HTMLInputElement;
		expect(input).toBeTruthy();
		await user.clear(input);
		await user.type(input, '275');
		await user.tab(); // commit on blur (change event)
		expect(onTierChange).toHaveBeenCalledWith('claude', 'custom', 275);
	});

	it('the Custom amount input is hidden for a non-custom tier', () => {
		setup(99, 'corporate');
		expect(screen.queryByLabelText('Claude custom monthly fee in USD')).toBeNull();
	});
});
