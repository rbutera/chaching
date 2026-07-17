import { describe, expect, it } from 'vitest';
import { defaultConfig, type chachingConfig } from '../config';
import type { FrozenAgg } from '../rollup/rollup';
import type { SessionSummary } from '../../types';
import { assertCursorScopeReady, planCursorImportScope } from './manager';

function withCursor(enabled: boolean, email: string | null): chachingConfig {
	const cfg = defaultConfig();
	cfg.providers.cursor = { enabled, adminApiToken: '', email, pollSeconds: 3600 };
	return cfg;
}

function agg(provider: string, day: string): FrozenAgg {
	return {
		day,
		provider,
		model: 'claude-opus-4-8',
		tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost: 0.1,
		costUnknownRequests: 0,
		cacheCreation1h: 0,
		cacheCreation5m: 0,
		webSearchRequests: 0,
		webFetchRequests: 0
	};
}

function session(provider: string): SessionSummary {
	return {
		sessionId: `${provider}-session`,
		provider,
		project: 'shared@example.com',
		firstTs: Date.parse('2026-07-10T00:00:00Z'),
		lastTs: Date.parse('2026-07-10T01:00:00Z'),
		tokens: { input: 10, output: 2, cacheCreation: 0, cacheRead: 0 },
		requests: 1,
		cost: 0.1,
		costUnknownRequests: 0,
		models: ['claude-opus-4-8']
	};
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

describe('planCursorImportScope (B2 import scoping)', () => {
	it('scopes cursor rows to cursor-account:<email> when an email is set', () => {
		const plan = planCursorImportScope(withCursor(true, 'Me@Example.com'), [agg('cursor', '2026-07-10')], [session('cursor')]);
		expect(plan.sourceScopes.cursor).toBe('cursor-account:me@example.com');
		expect(plan.aggregates).toHaveLength(1);
		expect(plan.sessions).toHaveLength(1);
		expect(plan.warning).toBeNull();
	});

	it('skips cursor rows (never per-machine scope) and warns when no email is set', () => {
		const plan = planCursorImportScope(
			withCursor(true, null),
			[agg('cursor', '2026-07-10'), agg('codex', '2026-07-10')],
			[session('cursor'), session('codex')]
		);
		// cursor rows dropped so they can't be imported under a machine scope (would double-count)
		expect(plan.aggregates.map((a) => a.provider)).toEqual(['codex']);
		expect(plan.sessions.map((s) => s.provider)).toEqual(['codex']);
		expect(plan.sourceScopes).toEqual({});
		expect(plan.warning).toMatch(/cursor.*email/i);
	});

	it('passes non-cursor history through untouched with no warning', () => {
		const plan = planCursorImportScope(withCursor(false, null), [agg('codex', '2026-07-10')], [session('codex')]);
		expect(plan.aggregates).toHaveLength(1);
		expect(plan.sessions).toHaveLength(1);
		expect(plan.sourceScopes).toEqual({});
		expect(plan.warning).toBeNull();
	});
});
