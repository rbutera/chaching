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
 * The policy a stored fragment was published under, from its `projectPolicy` key. Fragments from
 * before this setting existed carry none and were published with full paths.
 */
export function policyFromKey(key: unknown): ProjectPublishPolicy {
	if (key === undefined || key === null || key === 'full') return FULL_PROJECTS;
	if (key === 'basename' || key === 'hidden') return { mode: key };
	if (typeof key === 'string' && key.startsWith('label:') && key.length > 'label:'.length) return { mode: 'label', label: key.slice('label:'.length) };
	return { mode: 'hidden' };
}

/** A pooled activity fragment with the policy it was published under (absent: full paths). */
export type StoredFragment = SessionDay & { projectPolicy?: unknown };

/**
 * Rewrite one pooled session-activity row to the current policy (`to`). Each stored fragment
 * carries the policy it was published under, so one row can mix fragments from different policies
 * (e.g. an older chaching on the same machine merged full paths in after a change). `local` is
 * this machine's raw (unredacted) evidence for the session, or undefined once it is gone locally.
 *
 * Each stored fragment is compared with local evidence redacted the way THAT fragment was. The part
 * local explains is replaced by local's own fragments, redacted the new way. A remainder (work the
 * pool knows about but local evidence no longer covers) keeps its stored project, redacted the new
 * way. Remainders from one policy that collapse onto one project are summed (distinct work).
 * Remainders from different policies that land on one project are taken to be the same work
 * published twice, so the larger wins, matching the publish upsert's own larger-count rule. That
 * is a deliberate choice for a case nothing can decide: with no local evidence left, a mixed row
 * can't show whether its fragments overlap. Summing would double-count the common case (one session
 * republished under the new policy); taking the larger undercounts only disjoint work that a second,
 * older publisher added after the switch. Local evidence, when present, makes the result exact.
 */
export function reconcileActivityFragments(
	stored: readonly StoredFragment[],
	local: readonly SessionDay[] | undefined,
	to: ProjectPublishPolicy
): SessionDay[] {
	const explainedBy = new Map<string, Map<string, SessionDay>>();
	const remaindersBy = new Map<string, SessionDay[]>();
	for (const fragment of stored) {
		const from = policyFromKey(fragment.projectPolicy);
		const fromKey = projectPolicyKey(from);
		let explained = explainedBy.get(fromKey);
		if (!explained) {
			explained = new Map(redactFragments(local ?? [], from).map(row => [fragmentKey(row.day, row.project), row]));
			explainedBy.set(fromKey, explained);
		}
		const matched = explained.get(fragmentKey(fragment.day, fragment.project));
		const requests = fragment.requests - (matched?.requests ?? 0);
		if (requests <= 0) continue;
		const remainders = remaindersBy.get(fromKey) ?? [];
		remainders.push({
			day: fragment.day,
			project: fragment.project,
			requests,
			cost: Math.max(0, fragment.cost - (matched?.cost ?? 0)),
			costUnknownRequests: Math.min(requests, Math.max(0, fragment.costUnknownRequests - (matched?.costUnknownRequests ?? 0)))
		});
		remaindersBy.set(fromKey, remainders);
	}
	const remainder = new Map<string, SessionDay>();
	for (const group of remaindersBy.values()) {
		for (const fragment of redactFragments(group, to)) {
			const key = fragmentKey(fragment.day, fragment.project);
			const existing = remainder.get(key);
			if (!existing || fragment.requests > existing.requests) remainder.set(key, fragment);
		}
	}
	return redactFragments([...remainder.values(), ...(local ?? [])], to)
		.sort((a, b) => fragmentKey(a.day, a.project).localeCompare(fragmentKey(b.day, b.project)));
}

function fragmentKey(day: string, project: string): string {
	return `${day}\u001f${project}`;
}
