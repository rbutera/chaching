import { describe, expect, it } from 'vitest';
import { defaultConfig, type chachingConfig } from '../config';
import { assertCursorScopeReady } from './manager';

function withCursor(enabled: boolean, email: string | null): chachingConfig {
	const cfg = defaultConfig();
	cfg.providers.cursor = { enabled, adminApiToken: '', email, pollSeconds: 3600 };
	return cfg;
}

describe('assertCursorScopeReady (B2 create/join guard)', () => {
	it('throws when cursor is enabled but no email is configured', () => {
		expect(() => assertCursorScopeReady(withCursor(true, null))).toThrow(/cursor.*email/i);
		expect(() => assertCursorScopeReady(withCursor(true, '   '))).toThrow(/cursor.*email/i);
	});

	it('does not throw when cursor is enabled with an email', () => {
		expect(() => assertCursorScopeReady(withCursor(true, 'me@example.com'))).not.toThrow();
	});

	it('does not throw when cursor is disabled (email irrelevant)', () => {
		expect(() => assertCursorScopeReady(withCursor(false, null))).not.toThrow();
	});
});
