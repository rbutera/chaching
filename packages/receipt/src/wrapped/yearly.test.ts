import { reportAccountFees } from '@chaching/shared/accounts';
import { expect, it } from 'vitest';
import type { RollupSnapshot, SessionActivity } from '@chaching/shared/types';
import { buildYearlyWrapped } from './yearly';
const now = Date.parse('2026-01-03T00:05Z');
const tokens = { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 };
function session(sessionId: string, project: string, day: string, cost: number): SessionActivity {
	return { sessionId, provider: 'claude', machineId: 'machine-a', activity: [{ day, project, cost, requests: 1, costUnknownRequests: 0 }] };
}
function snapshot(): RollupSnapshot {
	return { generatedAt: now, earliestDay: '2025-12-31', latestDay: '2026-01-02', totals: { tokens, cost: 200, requests: 22, costUnknownRequests: 0 },
		dayModel: [{ day: '2025-12-31', provider: 'claude', model: 'costly', machineId: 'machine-a', cost: 100, requests: 1, costUnknownRequests: 0, tokens },
			{ day: '2026-01-02', provider: 'claude', model: 'costly', machineId: 'machine-a', cost: 90, requests: 1, costUnknownRequests: 0, tokens },
			{ day: '2026-01-02', provider: 'claude', model: 'cheap', machineId: 'machine-b', cost: 10, requests: 20, costUnknownRequests: 0, tokens }],
		sessions: [], activity: [session('boundary', '/a/project', '2025-12-31', 100), session('current', '/b/project', '2026-01-02', 90)], blocks: [], models: [], providers: ['claude'], unknownPriceModels: [], stats: { filesScanned: 0, recordsCounted: 22, linesSkipped: 0, duplicatesSkipped: 0 }, cutoverTs: null, coverage: {} };
}
const fees = { claude: { enabled: true, monthlyUsd: 30, tier: 'manual' }, codex: { enabled: false, monthlyUsd: 0, tier: 'free' } };
const options = { year: 2026, now, scope: 'All machines', fees, machineNames: new Map([['machine-b', 'Busy machine']]) };
it('clips UTC years, keeps frequency distinct from money, and marks partial activity', () => {
	const result = buildYearlyWrapped(snapshot(), options);
	expect(result.from).toBe('2026-01-01'); expect(result.to).toBe('2026-01-03');
	expect(result.headline.cost).toBe(100);
	expect(result.comparison.windowFeeUsd).toBe(3);
	expect(result.highlights[0].value).toContain('90');
	expect(result.highlights[1].detail).toContain('1 active UTC days');
	expect(result.highlights[2].value).toBe('Busy machine');
	expect(result.highlights[3].value).toBe('cheap');
	expect(result.partial).toBe(true); expect(result.activityPartial).toBe(true);
});
it('suppresses an unconditional biggest-session winner with unknown prices and redacts every identity', () => {
	const input = snapshot(); input.activity![1].activity[0].costUnknownRequests = 1;
	const result = buildYearlyWrapped(input, { ...options, redact: true });
	expect(result.highlights[0].value).toBe('Unavailable');
	expect(JSON.stringify(result)).not.toMatch(/\/a\/|\/b\/|Busy machine|machine-b|current|boundary/);
});
it('does not derive activity from old whole-session summaries or award unknown projects', () => {
	const input = snapshot(); input.activity = [];
	const result = buildYearlyWrapped(input, options);
	expect(result.highlights.slice(0, 2).map(row => row.value)).toEqual(['Unavailable', 'Unavailable']);
	expect(() => buildYearlyWrapped(input, { ...options, year: 2027 })).toThrow('Invalid');
});
it('counts a project day once across providers while keeping same-basename checkouts separate', () => {
	const input = snapshot();
	input.activity = [session('one', '/a/project', '2026-01-01', 1), { ...session('two', '/a/project', '2026-01-01', 1), provider: 'codex' },
		session('three', '/b/project', '2026-01-02', 1), session('four', '/unique/winner', '2026-01-01', 1), session('five', '/unique/winner', '2026-01-02', 1)];
	const result = buildYearlyWrapped(input, options);
	expect(result.highlights[1].value).toBe('winner');
	expect(result.highlights[1].detail).toContain('2 active UTC days');
});

it('deduplicates shared Account fees without per-Account usage shares and preserves unknown and free fees', () => {
	const account = { id: 'shared', provider: 'claude', name: 'Shared', account: '', tier: 'manual', monthlyUsd: 30, feeSource: 'explicit' as const };
	const config = { accounts: [account], providerAccounts: { claude: ['shared'] }, providers: { claude: { enabled: true }, codex: { enabled: false } } };
	const status = { enabled: true, accounts: [account, account], mappings: [{ machineId: 'machine-a', provider: 'claude', accountId: 'shared' }, { machineId: 'machine-b', provider: 'claude', accountId: 'shared' }] };
	const result = buildYearlyWrapped(snapshot(), { ...options, fees: reportAccountFees(config, status) });
	expect(result.comparison.windowFeeUsd).toBe(3);
	expect(result.comparison.sub.apiEquivalentUsd).toBe(100);
	for (const fee of [null, 0]) {
		const next = buildYearlyWrapped(snapshot(), { ...options, fees: reportAccountFees(config, { ...status, accounts: [{ ...account, monthlyUsd: fee }] }) });
		expect(next.comparison.windowFeeUsd).toBe(fee); expect(next.comparison.sub.multiple).toBeNull();
	}
});

it('recovers real Cursor bridge machine counts without assigning Admin usage to its publisher', () => {
	const input = snapshot();
	input.dayModel = [{ day: '2026-01-02', provider: 'cursor', model: 'cheap', cost: 1000, requests: 1000, costUnknownRequests: 0, tokens }];
	input.activity = [{ provider: 'cursor', sessionId: 'local-bridge', machineId: 'machine-b', activity: [{ day: '2026-01-02', project: '/real/project', requests: 3, cost: 1, costUnknownRequests: 0 }] }];
	const result = buildYearlyWrapped(input, options);
	expect(result.highlights[2]).toMatchObject({ value: 'Busy machine', detail: '3 observed usage records · Partial history' });
	expect(result.highlights[3].detail).toContain('1,000 observed usage records');
	input.activity = [];
	expect(buildYearlyWrapped(input, options).highlights[2].value).toBe('Unavailable');
});
