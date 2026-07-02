// Unit tests for the PURE doctor report builder. No I/O, no clock — every fact is
// injected, so these assert the diagnosis logic (health rollup, source-missing FAIL,
// staleness WARN + hint, history + pricing coverage) directly.

import { describe, it, expect } from 'vitest';
import {
	buildDoctorReport,
	type DoctorInput,
	type DoctorProviderInput,
	type ProviderName
} from './doctor.js';

function provider(overrides: Partial<DoctorProviderInput> & { provider: ProviderName }): DoctorProviderInput {
	return {
		enabled: true,
		sourceLabel: 'source',
		sourceExists: true,
		fileCount: 3,
		newestMtime: Date.parse('2026-07-02T09:00:00Z'),
		latestDay: '2026-07-02',
		todayRequests: 5,
		todayCost: 1.23,
		error: null,
		...overrides
	};
}

function baseInput(overrides: Partial<DoctorInput> = {}): DoctorInput {
	return {
		todayUTC: '2026-07-02',
		providers: [provider({ provider: 'claude' })],
		history: {
			enabled: true,
			dbPath: '/tmp/history.db',
			dbExists: true,
			frozenDayCount: 10,
			latestFrozenDay: '2026-07-01',
			scanPartial: false
		},
		unknownPriceModels: [],
		server: { port: 5178, reachable: false },
		...overrides
	};
}

function sectionByTitle(report: ReturnType<typeof buildDoctorReport>, needle: string) {
	const s = report.sections.find((x) => x.title.includes(needle));
	if (!s) throw new Error(`no section matching ${needle}`);
	return s;
}

describe('buildDoctorReport — overall health', () => {
	it('all-good input is OK', () => {
		const report = buildDoctorReport(baseInput());
		expect(report.overall).toBe('OK');
		expect(report.hasFail).toBe(false);
	});

	it('a missing enabled source is FAIL', () => {
		const report = buildDoctorReport(
			baseInput({ providers: [provider({ provider: 'codex', sourceExists: false })] })
		);
		expect(report.overall).toBe('FAIL');
		expect(report.hasFail).toBe(true);
		const s = sectionByTitle(report, 'Codex');
		expect(s.status).toBe('FAIL');
		expect(s.lines.some((l) => l.status === 'FAIL' && l.text.includes('source not found'))).toBe(true);
	});

	it('a captured ingest error is FAIL', () => {
		const report = buildDoctorReport(
			baseInput({ providers: [provider({ provider: 'codex', error: 'EACCES: permission denied' })] })
		);
		expect(report.hasFail).toBe(true);
		const s = sectionByTitle(report, 'Codex');
		expect(s.lines.some((l) => l.text.includes('EACCES'))).toBe(true);
	});
});

describe('buildDoctorReport — providers', () => {
	it('disabled provider is a neutral OK note, not a warning', () => {
		const report = buildDoctorReport(
			baseInput({ providers: [provider({ provider: 'opencode', enabled: false })] })
		);
		const s = sectionByTitle(report, 'OpenCode');
		expect(s.status).toBe('OK');
		expect(s.lines.some((l) => l.text.includes('disabled'))).toBe(true);
	});

	it('cursor enabled without a token is FAIL', () => {
		const report = buildDoctorReport(
			baseInput({
				providers: [
					provider({
						provider: 'cursor',
						sourceExists: null,
						fileCount: null,
						newestMtime: null,
						tokenPresent: false
					})
				]
			})
		);
		expect(report.hasFail).toBe(true);
		const s = sectionByTitle(report, 'Cursor');
		expect(s.lines.some((l) => l.text.includes('no Admin API token'))).toBe(true);
	});

	it('cursor enabled WITH a token is OK', () => {
		const report = buildDoctorReport(
			baseInput({
				providers: [
					provider({
						provider: 'cursor',
						sourceExists: null,
						fileCount: null,
						newestMtime: null,
						tokenPresent: true
					})
				]
			})
		);
		expect(sectionByTitle(report, 'Cursor').status).toBe('OK');
	});

	it('an empty (zero-file) source warns', () => {
		const report = buildDoctorReport(
			baseInput({ providers: [provider({ provider: 'codex', fileCount: 0, latestDay: null, newestMtime: null })] })
		);
		const s = sectionByTitle(report, 'Codex');
		expect(s.status).toBe('WARN');
		expect(s.lines.some((l) => l.text.includes('no data files'))).toBe(true);
	});
});

describe('buildDoctorReport — staleness', () => {
	it('flags a provider whose newest source day is after its latest ingested day', () => {
		const report = buildDoctorReport(
			baseInput({
				providers: [
					provider({
						provider: 'codex',
						newestMtime: Date.parse('2026-07-02T12:00:00Z'),
						latestDay: '2026-07-01'
					})
				]
			})
		);
		expect(report.staleness).toBe(true);
		const codex = sectionByTitle(report, 'Codex');
		expect(codex.status).toBe('WARN');
		expect(codex.lines.some((l) => l.text.includes('must be restarted'))).toBe(true);
		// The cross-cutting Staleness section is added with the v1.9.0 hint.
		const stale = sectionByTitle(report, 'Staleness');
		expect(stale.lines.some((l) => l.text.includes('v1.9.0'))).toBe(true);
	});

	it('mentions a reachable server in the staleness hint', () => {
		const report = buildDoctorReport(
			baseInput({
				providers: [provider({ provider: 'codex', newestMtime: Date.parse('2026-07-02T12:00:00Z'), latestDay: '2026-07-01' })],
				server: { port: 42619, reachable: true }
			})
		);
		const stale = sectionByTitle(report, 'Staleness');
		expect(stale.lines.some((l) => l.status === 'WARN' && l.text.includes('42619'))).toBe(true);
	});

	it('does not flag staleness when a provider errored (error, not stale, is the story)', () => {
		const report = buildDoctorReport(
			baseInput({
				providers: [
					provider({
						provider: 'codex',
						error: 'boom',
						newestMtime: Date.parse('2026-07-02T12:00:00Z'),
						latestDay: '2026-07-01'
					})
				]
			})
		);
		expect(report.staleness).toBe(false);
	});
});

describe('buildDoctorReport — history + pricing', () => {
	it('warns when history is disabled', () => {
		const report = buildDoctorReport(
			baseInput({ history: { enabled: false, dbPath: '', dbExists: false, frozenDayCount: 0, latestFrozenDay: null, scanPartial: false } })
		);
		expect(sectionByTitle(report, 'History').status).toBe('WARN');
	});

	it('warns when the scan is partial (freezing blocked)', () => {
		const report = buildDoctorReport(
			baseInput({
				history: { enabled: true, dbPath: '/tmp/h.db', dbExists: true, frozenDayCount: 3, latestFrozenDay: '2026-07-01', scanPartial: true }
			})
		);
		const s = sectionByTitle(report, 'History');
		expect(s.status).toBe('WARN');
		expect(s.lines.some((l) => l.text.includes('partial'))).toBe(true);
	});

	it('lists unknown-price models as a warning', () => {
		const report = buildDoctorReport(baseInput({ unknownPriceModels: ['mystery-model-1', 'mystery-model-2'] }));
		const s = sectionByTitle(report, 'Pricing');
		expect(s.status).toBe('WARN');
		expect(s.lines.some((l) => l.text.includes('mystery-model-1'))).toBe(true);
		expect(s.lines.some((l) => l.text.includes('mystery-model-2'))).toBe(true);
	});

	it('pricing coverage is OK when every model is priced', () => {
		const report = buildDoctorReport(baseInput({ unknownPriceModels: [] }));
		expect(sectionByTitle(report, 'Pricing').status).toBe('OK');
	});
});
