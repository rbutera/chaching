import type { SyncConfig } from '@chaching/shared/config';
import type { SessionActivity, SessionDay, SessionSummary } from '@chaching/shared/types';

/** The project published for every session in `hidden` mode. */
export const HIDDEN_PROJECT = '(hidden)';

/**
 * The resolved per-machine rule for the `project` value that leaves this machine. Applied only at
 * the pool publish boundary (the sync store); the local rollup, dashboard and SQLite keep the
 * real path.
 */
export type ProjectPublishPolicy =
	| { mode: 'full' }
	| { mode: 'basename' }
	| { mode: 'hidden' }
	| { mode: 'label'; label: string };

export const FULL_PROJECTS: ProjectPublishPolicy = { mode: 'full' };

/** `label` with no label fails closed to `hidden`, never back to full paths. */
export function projectPublishPolicy(sync: Pick<SyncConfig, 'publishProjects' | 'projectLabel'>): ProjectPublishPolicy {
	const label = sync.projectLabel.trim();
	switch (sync.publishProjects) {
		case 'full': return FULL_PROJECTS;
		case 'basename': return { mode: 'basename' };
		case 'hidden': return { mode: 'hidden' };
		case 'label': return label ? { mode: 'label', label } : { mode: 'hidden' };
	}
}

/** Stable identity of a policy, so the engine can tell when it changed. */
export function projectPolicyKey(policy: ProjectPublishPolicy): string {
	return policy.mode === 'label' ? `label:${policy.label}` : policy.mode;
}

/** The empty project means "unknown" everywhere and carries nothing, so every mode keeps it. */
export function redactProject(project: string, policy: ProjectPublishPolicy): string {
	if (project === '') return project;
	switch (policy.mode) {
		case 'full': return project;
		case 'basename': return project.split(/[/\\]/).filter(Boolean).at(-1) ?? '';
		case 'hidden': return HIDDEN_PROJECT;
		case 'label': return policy.label;
	}
}

export function redactSessions(sessions: readonly SessionSummary[], policy: ProjectPublishPolicy): readonly SessionSummary[] {
	if (policy.mode === 'full') return sessions;
	return sessions.map(session => ({ ...session, project: redactProject(session.project, policy) }));
}

export function redactActivity(rows: readonly SessionActivity[], policy: ProjectPublishPolicy): readonly SessionActivity[] {
	if (policy.mode === 'full') return rows;
	return rows.map(row => ({ ...row, activity: redactFragments(row.activity, policy) }));
}

/**
 * Redact each fragment's project, then sum fragments that now share a (day, project): two real
 * projects on one day are separate work, so collapsing them under one label must add, not pick.
 */
export function redactFragments(fragments: readonly SessionDay[], policy: ProjectPublishPolicy): SessionDay[] {
	const merged = new Map<string, SessionDay>();
	for (const fragment of fragments) {
		const project = redactProject(fragment.project, policy);
		const key = fragmentKey(fragment.day, project);
		const existing = merged.get(key);
		merged.set(key, existing ? {
			day: fragment.day,
			project,
			requests: existing.requests + fragment.requests,
			cost: existing.cost + fragment.cost,
			costUnknownRequests: existing.costUnknownRequests + fragment.costUnknownRequests
		} : { ...fragment, project });
	}
	return [...merged.values()];
}

/**
 * Rewrite one pooled session-activity row after the publish policy changed. `stored` is what the
 * pool holds (possibly published under an older policy); `local` is this machine's current
 * evidence for the session, already redacted with the current policy (absent once the session is
 * gone locally).
 *
 * - Stored fragments are redacted with the current policy (a rename to a label, or to a basename).
 * - Where local evidence covers a day, a stored fragment whose project local doesn't have for
 *   that day is stale labelling from an older policy and is dropped, so a later switch (e.g. back
 *   to `full`) can't count the same requests twice under two names.
 * - The rest merges like the publish upsert: one fragment per (day, project), the larger
 *   request count winning (ties go to local).
 */
export function reconcileActivityFragments(
	stored: readonly SessionDay[],
	local: readonly SessionDay[] | undefined,
	policy: ProjectPublishPolicy
): SessionDay[] {
	const localProjects = new Map<string, Set<string>>();
	for (const fragment of local ?? []) {
		const projects = localProjects.get(fragment.day) ?? new Set<string>();
		projects.add(fragment.project);
		localProjects.set(fragment.day, projects);
	}
	const kept = redactFragments(stored, policy).filter(fragment =>
		localProjects.get(fragment.day)?.has(fragment.project) ?? true);
	const merged = new Map<string, SessionDay>();
	for (const fragment of [...kept, ...(local ?? [])]) {
		const key = fragmentKey(fragment.day, fragment.project);
		const existing = merged.get(key);
		if (!existing || fragment.requests >= existing.requests) merged.set(key, fragment);
	}
	return [...merged.values()].sort((a, b) => fragmentKey(a.day, a.project).localeCompare(fragmentKey(b.day, b.project)));
}

function fragmentKey(day: string, project: string): string {
	return `${day}\u001f${project}`;
}
