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
 * The policy a stored row was published under, from the `projectPolicy` key its payload carries.
 * Rows from before this setting existed carry none and were published with full paths.
 */
export function policyFromKey(key: unknown): ProjectPublishPolicy {
	if (key === undefined || key === null || key === 'full') return FULL_PROJECTS;
	if (key === 'basename' || key === 'hidden') return { mode: key };
	if (typeof key === 'string' && key.startsWith('label:') && key.length > 'label:'.length) return { mode: 'label', label: key.slice('label:'.length) };
	return { mode: 'hidden' };
}

/**
 * Rewrite one pooled session-activity row from the policy it was published under (`from`) to the
 * current one (`to`). `local` is this machine's raw (unredacted) evidence for the session, or
 * undefined once the session is gone locally.
 *
 * Each stored fragment is matched against local evidence redacted the OLD way. The part local
 * still explains is replaced by local's own fragments, redacted the new way; any remainder (work
 * the pool knows about but local evidence no longer covers) is kept under the stored project,
 * redacted the new way. Requests are therefore neither dropped nor counted twice, whatever the
 * direction of the change (label to full, full to label, label to another label).
 */
export function reconcileActivityFragments(
	stored: readonly SessionDay[],
	local: readonly SessionDay[] | undefined,
	from: ProjectPublishPolicy,
	to: ProjectPublishPolicy
): SessionDay[] {
	const explained = new Map(redactFragments(local ?? [], from).map(fragment => [fragmentKey(fragment.day, fragment.project), fragment]));
	const remainder = stored.flatMap(fragment => {
		const matched = explained.get(fragmentKey(fragment.day, fragment.project));
		const requests = fragment.requests - (matched?.requests ?? 0);
		if (requests <= 0) return [];
		return [{
			day: fragment.day,
			project: fragment.project,
			requests,
			cost: Math.max(0, fragment.cost - (matched?.cost ?? 0)),
			costUnknownRequests: Math.min(requests, Math.max(0, fragment.costUnknownRequests - (matched?.costUnknownRequests ?? 0)))
		}];
	});
	return redactFragments([...remainder, ...(local ?? [])], to)
		.sort((a, b) => fragmentKey(a.day, a.project).localeCompare(fragmentKey(b.day, b.project)));
}

function fragmentKey(day: string, project: string): string {
	return `${day}\u001f${project}`;
}
