import { describe, it, expect } from 'vitest';
import type { ReceiptModel } from './model.js';
import { redactReceipt, PLACEHOLDER } from './redact.js';
import { renderReceiptText } from './render-text.js';

// Adversarial fixture: every redactable class present in free-text fields.
const SECRET_USER = 'topsecretuser';
const SECRET_HOST = 'topsecrethost';
const SECRET_PATH = '/home/topsecretuser/projects/my-private-thing/file.ts';
const SECRET_PROJECT = 'topsecretuser/projects/my-private-thing';

function adversarialModel(): ReceiptModel {
	return {
		wordmark: `chaching @ ${SECRET_HOST}`,
		periodLabel: `all time (${SECRET_USER})`,
		period: undefined,
		from: '2026-06-01',
		to: '2026-06-19',
		providers: null,
		lineItems: [
			{
				provider: 'claude',
				model: 'claude-opus-4-8',
				modelLabel: `Opus 4.8 ${SECRET_PROJECT}`,
				family: 'opus',
				tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 1 },
				requests: 1,
				cost: 1,
				unknownPrice: false
			}
		],
		coupons: [
			{
				model: 'claude-opus-4-8',
				modelLabel: `Opus 4.8 ${SECRET_HOST}`,
				family: 'opus',
				cacheReadTokens: 1,
				wouldHaveCost: 1,
				actualCost: 0,
				saved: 1
			}
		],
		youSaved: 1,
		cacheCost: { cacheReadTokens: 0, cacheReadCost: 0, cacheWriteTokens: 0, cacheWriteCost: 0, savedVsUncached: 0 },
		subsidisation: null,
		subtotals: [{ family: 'opus', cost: 1, requests: 1 }],
		totalBurn: 1,
		totalTokens: 3,
		requests: 1,
		costUnknownRequests: 0,
		unknownPriceModels: [],
		footer: `thanks ${SECRET_USER} at ${SECRET_PATH}`,
		barcode: '▌▏▎',
		ref: `REF · ${SECRET_HOST}`,
		empty: false
	};
}

// Opt-in: redaction now requires `redact: true`. These injectable identity opts
// are shared by every scrub test (each opts IN explicitly).
const redactOpts = {
	redact: true,
	username: SECRET_USER,
	hostname: SECRET_HOST,
	homedir: `/home/${SECRET_USER}`,
	env: {} as NodeJS.ProcessEnv
};

describe('redactReceipt — opt-in scrubbing', () => {
	it('redact=true scrubs username, hostname, abs path, project from all text', () => {
		const redacted = redactReceipt(adversarialModel(), redactOpts);
		const text = renderReceiptText(redacted, { noColor: true });
		expect(text).not.toContain(SECRET_USER);
		expect(text).not.toContain(SECRET_HOST);
		expect(text).not.toContain(SECRET_PATH);
		expect(text).not.toContain('my-private-thing/file.ts');
		// the placeholder or basename collapse should appear instead
		expect(redacted.footer).toContain(PLACEHOLDER);
	});

	it('default (no redact) is a no-op — real values present', () => {
		const shown = redactReceipt(adversarialModel(), {
			username: SECRET_USER,
			hostname: SECRET_HOST,
			homedir: `/home/${SECRET_USER}`,
			env: {} as NodeJS.ProcessEnv
		});
		const text = renderReceiptText(shown, { noColor: true });
		expect(text).toContain(SECRET_HOST);
		expect(text).toContain(SECRET_USER);
	});

	it('deprecated reveal=true still forces a no-op (real values present)', () => {
		const revealed = redactReceipt(adversarialModel(), { ...redactOpts, reveal: true });
		const text = renderReceiptText(revealed, { noColor: true });
		expect(text).toContain(SECRET_HOST);
		expect(text).toContain(SECRET_USER);
	});

	it('redacted output differs from shown exactly on the secret tokens', () => {
		const redacted = redactReceipt(adversarialModel(), redactOpts);
		const shown = redactReceipt(adversarialModel(), { ...redactOpts, redact: false });
		expect(redacted.wordmark).not.toBe(shown.wordmark);
		expect(redacted.footer).not.toBe(shown.footer);
		expect(redacted.ref).not.toBe(shown.ref);
		// non-secret fields are untouched
		expect(redacted.totalBurn).toBe(shown.totalBurn);
		expect(redacted.from).toBe(shown.from);
	});

	it('does not mutate the input model', () => {
		const input = adversarialModel();
		const before = input.footer;
		redactReceipt(input, redactOpts);
		expect(input.footer).toBe(before);
	});

	it('scrubs a username smuggled in via --provider (providers[] field)', () => {
		const m = adversarialModel();
		m.providers = [SECRET_USER, 'codex'];
		const redacted = redactReceipt(m, redactOpts);
		expect(redacted.providers).not.toContain(SECRET_USER);
		const text = renderReceiptText(redacted, { noColor: true });
		expect(text).not.toContain(SECRET_USER);
	});

	it('collapses paths containing special chars without leaking the tail', () => {
		const m = adversarialModel();
		// path with @, parens, +, spaces — the old [\w.- ] class would truncate here
		m.footer = 'log at /Users/topsecretuser/Client (Secret+Co)/run@2/private.ts done';
		const redacted = redactReceipt(m, redactOpts);
		// every interior path segment must be gone (collapsed to the basename)
		expect(redacted.footer).not.toContain('topsecretuser');
		expect(redacted.footer).not.toContain('Client (Secret+Co)');
		expect(redacted.footer).not.toContain('run@2');
		// no surviving absolute-path prefix
		expect(redacted.footer).not.toContain('/Users/');
	});
});
