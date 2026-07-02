// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import userEvent from '@testing-library/user-event';
import SubsidisationCard from './SubsidisationCard.svelte';
import { buildWindowSubsidisation, type ProviderSubsidisationConfig } from '$lib/core/subsidisation';
import type { DayModelAgg } from '$lib/types';

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

// Ten days of flat spend so day/week windows carve distinct sums.
const grain: DayModelAgg[] = [];
for (let i = 6; i <= 15; i++) {
	const day = `2026-06-${String(i).padStart(2, '0')}`;
	grain.push(agg(day, 'claude', 'claude-opus-4-8', 100));
	grain.push(agg(day, 'codex', 'gpt-5', 10));
}

const WEEK = { from: '2026-06-09', to: '2026-06-15' }; // 7 days in-grain
const DAY = { from: '2026-06-15', to: '2026-06-15' };

function setup(claudeFee = 99, claudeTier = 'corporate', window = WEEK) {
	const config = {
		claude: enabled(claudeTier, claudeFee),
		codex: enabled('pro', 20)
	};
	const rollup = buildWindowSubsidisation(grain, config, window);
	const onTierChange = vi.fn();
	render(SubsidisationCard, { rollup, windowLabel: 'Last 7 days', config, onTierChange });
	return { onTierChange, rollup };
}

describe('SubsidisationCard — window-based (follows the period selector)', () => {
	it('renders the combined multiple over the WINDOW fee (fee/30 daily rate)', () => {
		// week: burn (100+10)*7 = 770; fee (99+20)/30*7 = 27.766…
		const { rollup } = setup();
		expect(rollup.combined.windowFeeUsd).toBeCloseTo(((99 + 20) / 30) * 7, 6);
		expect(rollup.combined.sub.apiEquivalentUsd).toBeCloseTo(770, 6);
		expect(screen.getByLabelText('combined subsidy multiple').textContent).toContain('×');
	});

	it('a 1-day window compares against fee/30 exactly', () => {
		const config = { claude: enabled('max20', 200), codex: enabled('pro20', 200) };
		const rollup = buildWindowSubsidisation(grain, config, DAY);
		expect(rollup.windowDays).toBe(1);
		expect(rollup.combined.windowFeeUsd).toBeCloseTo(400 / 30, 6);
		// codex: $10 vs $6.67 → positive net even on the day view
		const codex = rollup.providers.find((p) => p.provider === 'codex')!;
		expect(codex.windowFeeUsd).toBeCloseTo(200 / 30, 6);
		expect(codex.sub.netSubsidyUsd).toBeGreaterThan(0);
	});

	it('a 30-day window equals the full monthly fee exactly', () => {
		const config = { claude: enabled('max20', 200), codex: enabled('pro20', 200) };
		const rollup = buildWindowSubsidisation(grain, config, {
			from: '2026-05-17',
			to: '2026-06-15'
		});
		expect(rollup.windowDays).toBe(30);
		expect(rollup.combined.windowFeeUsd).toBeCloseTo(400, 10);
	});

	it('names the window and the pro-rated fee in the basis line', () => {
		setup();
		expect(document.body.textContent).toContain('Last 7 days');
		expect(document.body.textContent).toContain('7 days of fee at 1/30 per day');
	});

	it('positive net renders "+$ subsidy"; a shortfall renders a plain net figure, no verdict', () => {
		// claude burn 700 vs pro-rated 23.1 → positive; give codex a huge fee → negative
		const config = { claude: enabled('corporate', 99), codex: enabled('custom', 100000) };
		const rollup = buildWindowSubsidisation(grain, config, WEEK);
		render(SubsidisationCard, {
			rollup,
			windowLabel: 'Last 7 days',
			config,
			onTierChange: vi.fn()
		});
		expect(document.body.textContent).toContain('subsidy');
		expect(document.body.textContent).toContain('vs the pro-rated fee');
		expect(document.body.textContent).not.toContain('under-using');
		expect(document.body.textContent).not.toContain('too early to call');
	});

	it('shows the $0 Free tier as "∞ — all of it" (no Infinity/NaN)', () => {
		const config = { claude: enabled('free', 0), codex: enabled('free', 0) };
		const rollup = buildWindowSubsidisation(grain, config, WEEK);
		render(SubsidisationCard, {
			rollup,
			windowLabel: 'Last 7 days',
			config,
			onTierChange: vi.fn()
		});
		expect(screen.getByLabelText('combined subsidy multiple').textContent).toContain('∞');
		expect(document.body.textContent).not.toContain('Infinity');
		expect(document.body.textContent).not.toContain('NaN');
	});

	it('selecting a preset emits onTierChange with the preset id + fee', async () => {
		const user = userEvent.setup();
		const { onTierChange } = setup();
		const select = screen.getByLabelText('Claude plan') as HTMLSelectElement;
		await user.selectOptions(select, 'max-5x');
		expect(onTierChange).toHaveBeenCalledWith('claude', 'max-5x', 100);
	});

	it('selecting Custom reveals the amount input and commits the typed value', async () => {
		const user = userEvent.setup();
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
