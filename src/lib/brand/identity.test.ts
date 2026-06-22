/**
 * Identity-integration guards: assert the two "default scaffold" tells stay
 * dead and the brand surfaces carry the honest, multi-provider copy + the brass
 * accent. These are cheap source-level assertions (the change is static identity
 * integration, not interactive UI — see design.md Interaction Test Plan).
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { tokens } from './tokens.js';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..', '..');
const read = (rel: string) => readFileSync(join(root, rel), 'utf8');

const BRASS = '#e0a52f';

describe('honest copy', () => {
	const page = read('src/routes/+page.svelte');
	const html = read('src/app.html');
	const readme = read('README.md');

	it('no machine-leaking host name in user-facing copy', () => {
		expect(page).not.toMatch(/kinto/i);
		expect(html).not.toMatch(/kinto/i);
	});

	it('no false Claude-only placeholder tagline', () => {
		expect(page).not.toContain('Claude Code spend');
	});

	it('no placeholder glyph remains in the header', () => {
		expect(page).not.toContain('◈');
	});

	it('the honest tagline is present in the header', () => {
		expect(page).toContain('local AI token spend');
	});

	it('app.html advertises the multi-provider description and OG card', () => {
		expect(html).toContain('Claude Code, Codex, OpenCode, Cursor');
		expect(html).toContain('og:image');
		expect(html).toContain('summary_large_image');
	});

	it('README hero replaces the screenshot placeholder', () => {
		expect(readme).not.toContain('screenshot / asciinema placeholder');
		expect(readme).toContain('local AI token spend');
	});
});

describe('brand accent is brass', () => {
	it('tokens accent is the brass value', () => {
		expect(tokens.accent.hex).toBe(BRASS);
	});

	it('static/icon.svg (favicon source) is brass, not the old stock gold', () => {
		const icon = read('static/icon.svg');
		expect(icon).toContain(BRASS);
		expect(icon).not.toContain('#e8b54a');
		expect(icon).not.toContain('svelte-logo');
	});
});
