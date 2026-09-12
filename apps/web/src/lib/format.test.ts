/**
 * Family-anchor parity: the hue each model family's color spread is anchored to
 * must match the hue of that family's brand token. This keeps src/lib/format.ts's
 * per-id HSL hash-spread pinned to the token source of truth (design D3/3.2).
 */

import { describe, it, expect } from 'vitest';

import { money, modelColor, modelFamily, modelLabel, providerLabel, hueOf } from '@chaching/shared/format';
import { tokens } from '@chaching/shared/brand/tokens';

describe('modelFamily', () => {
	it('classifies known model ids', () => {
		expect(modelFamily('claude-opus-4-8')).toBe('opus');
		expect(modelFamily('claude-sonnet-4-5')).toBe('sonnet');
		expect(modelFamily('claude-haiku-3-5')).toBe('haiku');
		expect(modelFamily('gpt-5')).toBe('other');
	});
});

describe('Pi / OMP labels', () => {
	it('labels the shared provider and the major-only Opus 5 model id', () => {
		expect(providerLabel('pi')).toBe('Pi / OMP');
		expect(modelLabel('claude-opus-5')).toBe('Opus 5');
	});
});

describe('family-anchor parity', () => {
	const families = ['opus', 'sonnet', 'haiku', 'other'] as const;

	for (const fam of families) {
		it(`${fam} family anchor hue matches its brand token`, () => {
			// The center of the family's hash-spread is its anchor hue. Averaging the
			// hue across many ids cancels the ±28° per-id offset, recovering the anchor.
			const tokenHue = hueOf(tokens.models[fam].hex);
			const ids = Array.from({ length: 400 }, (_, i) => `${fam}-model-${i}`);
			const hues = ids.map((id) => {
				const m = modelColor(id).match(/hsl\((\d+)deg/);
				expect(m).not.toBeNull();
				return Number(m![1]);
			});
			// Average via unit vectors to handle the 0/360 wrap.
			const x = hues.reduce((s, h) => s + Math.cos((h * Math.PI) / 180), 0);
			const y = hues.reduce((s, h) => s + Math.sin((h * Math.PI) / 180), 0);
			const meanHue = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
			let diff = Math.abs(meanHue - tokenHue);
			if (diff > 180) diff = 360 - diff;
			expect(diff).toBeLessThan(8);
		});
	}
});

it('keeps negative currency signs at every display precision', () => {
	expect(money(-50)).toBe('-$50.00');
	expect(money(-1500)).toBe('-$1,500');
	expect(money(-0.005)).toBe('-$0.0050');
	expect(money(-0)).toBe('$0.00');
});
