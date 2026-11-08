import { describe, expect, it } from 'vitest';
import type { SessionActivity, SessionDay, SessionSummary } from '@chaching/shared/types';
import {
	HIDDEN_PROJECT,
	policyFromKey,
	projectPolicyKey,
	projectPublishPolicy,
	reconcileActivityFragments,
	redactActivity,
	redactFragments,
	redactProject,
	redactSessions,
	type ProjectPublishPolicy
} from './project-privacy';

const FULL: ProjectPublishPolicy = { mode: 'full' };
const BASENAME: ProjectPublishPolicy = { mode: 'basename' };
const HIDDEN: ProjectPublishPolicy = { mode: 'hidden' };
const CONVEO: ProjectPublishPolicy = { mode: 'label', label: 'Conveo' };

function session(project: string): SessionSummary {
	return {
		sessionId: 's1', provider: 'claude', project, firstTs: 1, lastTs: 2,
		tokens: { input: 1, output: 1, cacheCreation: 0, cacheRead: 0 },
		requests: 1, cost: 0.5, costUnknownRequests: 0, models: ['opus']
	};
}

function day(dayValue: string, project: string, requests: number): SessionDay {
	return { day: dayValue, project, requests, cost: requests / 10, costUnknownRequests: 0 };
}

describe('projectPublishPolicy', () => {
	it('resolves each configured mode, and label without a label fails closed to hidden', () => {
		expect(projectPublishPolicy({ publishProjects: 'full', projectLabel: 'x' })).toEqual(FULL);
		expect(projectPublishPolicy({ publishProjects: 'basename', projectLabel: '' })).toEqual(BASENAME);
		expect(projectPublishPolicy({ publishProjects: 'hidden', projectLabel: '' })).toEqual(HIDDEN);
		expect(projectPublishPolicy({ publishProjects: 'label', projectLabel: ' Conveo ' })).toEqual(CONVEO);
		expect(projectPublishPolicy({ publishProjects: 'label', projectLabel: '  ' })).toEqual(HIDDEN);
	});

	it('keys policies so a label change is a policy change', () => {
		expect(projectPolicyKey(CONVEO)).toBe('label:Conveo');
		expect(projectPolicyKey({ mode: 'label', label: 'Acme' })).not.toBe(projectPolicyKey(CONVEO));
		expect(projectPolicyKey(FULL)).toBe('full');
	});
});

describe('redactProject', () => {
	const path = '/home/coder/conveo/branded-reels-w2g';

	it('publishes the path unchanged by default (full)', () => {
		expect(redactProject(path, FULL)).toBe(path);
	});

	it('keeps only the last segment in basename mode, for POSIX and Windows paths', () => {
		expect(redactProject(path, BASENAME)).toBe('branded-reels-w2g');
		expect(redactProject('/Users/rai/focused/launchpad/', BASENAME)).toBe('launchpad');
		expect(redactProject('C:\\work\\acme\\api', BASENAME)).toBe('api');
		expect(redactProject('codex', BASENAME)).toBe('codex');
	});

	it('replaces every project in hidden and label modes', () => {
		expect(redactProject(path, HIDDEN)).toBe(HIDDEN_PROJECT);
		expect(redactProject(path, CONVEO)).toBe('Conveo');
		expect(redactProject('(Tokenmaxx background)', CONVEO)).toBe('Conveo');
	});

	it('leaves the empty "unknown" project alone in every mode', () => {
		for (const policy of [FULL, BASENAME, HIDDEN, CONVEO]) expect(redactProject('', policy)).toBe('');
	});
});

describe('publish payload redaction', () => {
	it('returns the same session objects untouched under full', () => {
		const sessions = [session('/home/coder/conveo/reel-port')];
		expect(redactSessions(sessions, FULL)).toBe(sessions);
	});

	it('redacts session projects without mutating the local rollup objects', () => {
		const local = session('/home/coder/conveo/reel-port');
		const [published] = redactSessions([local], CONVEO);
		expect(published).toEqual({ ...local, project: 'Conveo' });
		expect(local.project).toBe('/home/coder/conveo/reel-port');
	});

	it('redacts activity fragments and sums projects that collapse onto one label', () => {
		const rows: SessionActivity[] = [{
			provider: 'claude', sessionId: 's1', machineId: 'm1',
			activity: [day('2026-11-07', '/home/coder/conveo/a', 3), day('2026-11-07', '/home/coder/conveo/b', 2), day('2026-11-08', '/home/coder/conveo/a', 1)]
		}];
		const [published] = redactActivity(rows, CONVEO);
		expect(published.activity).toEqual([
			{ day: '2026-11-07', project: 'Conveo', requests: 5, cost: 0.5, costUnknownRequests: 0 },
			{ day: '2026-11-08', project: 'Conveo', requests: 1, cost: 0.1, costUnknownRequests: 0 }
		]);
		expect(rows[0].activity).toHaveLength(3);
		expect(JSON.stringify(published)).not.toContain('/home/coder');
	});

	it('basename keeps distinct projects apart', () => {
		expect(redactFragments([day('d', '/x/a', 1), day('d', '/y/b', 1)], BASENAME).map(f => f.project)).toEqual(['a', 'b']);
	});
});

describe('policyFromKey', () => {
	it('reads the provenance stamped on published rows; none means full paths', () => {
		expect(policyFromKey(undefined)).toEqual(FULL);
		expect(policyFromKey('basename')).toEqual(BASENAME);
		expect(policyFromKey('label:Conveo')).toEqual(CONVEO);
		expect(policyFromKey(projectPolicyKey({ mode: 'label', label: 'a:b' }))).toEqual({ mode: 'label', label: 'a:b' });
		expect(policyFromKey('label:')).toEqual(HIDDEN);
		expect(policyFromKey('garbage')).toEqual(HIDDEN);
	});
});

describe('reconcileActivityFragments', () => {
	it('relabels full paths published before the setting, including sessions gone locally', () => {
		const stored = [day('2026-10-01', '/home/coder/conveo/old-feature', 4)];
		expect(reconcileActivityFragments(stored, undefined, FULL, CONVEO)).toEqual([day('2026-10-01', 'Conveo', 4)]);
	});

	it('keeps requests local evidence no longer explains when it is partial', () => {
		const stored = [day('2026-11-07', '/a', 3), day('2026-11-07', '/b', 2)];
		const local = [day('2026-11-07', '/a', 3)];
		expect(reconcileActivityFragments(stored, local, FULL, CONVEO)).toEqual([
			{ day: '2026-11-07', project: 'Conveo', requests: 5, cost: 0.5, costUnknownRequests: 0 }
		]);
	});

	it('switching back to full restores local paths without double counting, keeping an unexplained remainder', () => {
		const stored = [day('2026-11-07', 'Conveo', 5), day('2026-10-01', 'Conveo', 2)];
		const local = [day('2026-11-07', '/home/coder/conveo/a', 3)];
		expect(reconcileActivityFragments(stored, local, CONVEO, FULL)).toEqual([
			day('2026-10-01', 'Conveo', 2),
			day('2026-11-07', '/home/coder/conveo/a', 3),
			{ day: '2026-11-07', project: 'Conveo', requests: 2, cost: 0.2, costUnknownRequests: 0 }
		]);
	});

	it('moves a label to another label one-for-one', () => {
		const stored = [day('2026-11-07', 'Conveo', 5)];
		const local = [day('2026-11-07', '/x', 5)];
		expect(reconcileActivityFragments(stored, local, CONVEO, { mode: 'label', label: 'Work' })).toEqual([day('2026-11-07', 'Work', 5)]);
	});

	it('lets newer local evidence win over a smaller stored count', () => {
		expect(reconcileActivityFragments([day('d', '/p', 2)], [day('d', '/p', 7)], FULL, BASENAME)).toEqual([day('d', 'p', 7)]);
	});
});
