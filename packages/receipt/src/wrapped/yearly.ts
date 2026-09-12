import { sumGrain } from '@chaching/shared/aggregate';
import { normalizeProjectKey } from '@chaching/shared/view-model';
import { buildWindowSubsidisation, inclusiveDays, type ProviderSubsidisationConfig, type SubsidisedProvider } from '@chaching/shared/subsidisation';
import type { RollupSnapshot } from '@chaching/shared/types';
import { money, int } from '@chaching/shared/format';

export interface YearlyHighlight {
	label: string;
	value: string;
	detail: string;
}

export interface YearlyWrapped {
	year: number;
	yearToDate: boolean;
	from: string;
	to: string;
	availableFrom: string | null;
	availableTo: string | null;
	scope: string;
	partial: boolean;
	activityPartial: boolean;
	headline: ReturnType<typeof sumGrain>;
	comparisonUnknownRequests: number;
	comparison: ReturnType<typeof buildWindowSubsidisation>['combined'];
	highlights: YearlyHighlight[];
}

export function buildYearlyWrapped(snapshot: RollupSnapshot, options: {
	year: number;
	now?: number;
	scope: string;
	fees: Record<SubsidisedProvider, ProviderSubsidisationConfig>;
	machineNames?: ReadonlyMap<string, string>;
	redact?: boolean;
}): YearlyWrapped {
	const today = new Date(options.now ?? Date.now()).toISOString().slice(0, 10);
	const currentYear = Number(today.slice(0, 4));
	if (!Number.isInteger(options.year) || options.year < 2000 || options.year > currentYear) throw new Error('Invalid recap year');
	const from = `${options.year}-01-01`, to = options.year === currentYear ? today : `${options.year}-12-31`;
	const grain = snapshot.dayModel.filter(row => row.day >= from && row.day <= to);
	const headline = sumGrain(grain);
	const days = [...new Set(grain.map(row => row.day))].sort();
	const coverageDays = Object.entries(snapshot.coverage).filter(([day, state]) => day >= from && day <= to && (state === 'frozen' || state === 'zero' || day === today)).length;
	const partial = coverageDays < inclusiveDays(from, to);
	const sessions = new Map<string, { display: string; cost: number; unknown: number }>();
	const projects = new Map<string, { display: string; days: Set<string> }>();
	let evidencedRequests = 0;
	for (const session of (snapshot.activity ?? [])) {
		for (const activity of session.activity ?? []) {
			if (activity.day < from || activity.day > to) continue;
			evidencedRequests += activity.requests;
			const key = JSON.stringify([session.machineId ?? 'local', session.provider, session.sessionId]);
			const project = normalizeProjectKey(activity.project);
			const display = project.split('/').at(-1) || 'Unnamed project';
			const candidate = sessions.get(key) ?? { display, cost: 0, unknown: 0 };
			candidate.cost += activity.cost;
			candidate.unknown += activity.costUnknownRequests;
			sessions.set(key, candidate);
			if (project) {
				const projectKey = JSON.stringify([session.machineId ?? 'local', project]);
				const item = projects.get(projectKey) ?? { display, days: new Set<string>() };
				item.days.add(activity.day);
				projects.set(projectKey, item);
			}
		}
	}
	const activityPartial = partial || evidencedRequests < headline.requests;
	const orderedSessions = [...sessions].sort((a, b) => b[1].cost - a[1].cost || a[0].localeCompare(b[0]));
	const orderedProjects = [...projects].sort((a, b) => b[1].days.size - a[1].days.size || a[0].localeCompare(b[0]));
	const machines = new Map<string, number>(), models = new Map<string, number>();
	for (const row of grain) {
		if (row.machineId) machines.set(row.machineId, (machines.get(row.machineId) ?? 0) + row.requests);
		models.set(row.model, (models.get(row.model) ?? 0) + row.requests);
	}
	const winner = (items: Map<string, number>) => [...items].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
	const biggest = orderedSessions[0]?.[1], project = orderedProjects[0]?.[1], machine = winner(machines), model = winner(models);
	const observed = activityPartial ? 'Among retained activity' : 'In this recap';
	const highlights: YearlyHighlight[] = [
		{ label: 'Biggest session', value: biggest && !orderedSessions.some(([, row]) => row.unknown > 0) ? money(biggest.cost) : 'Unavailable', detail: biggest ? `${options.redact ? 'Project hidden' : biggest.display} · ${observed}` : 'No daily session evidence' },
		{ label: 'Most-used project', value: project ? options.redact ? 'Project hidden' : project.display : 'Unavailable', detail: project ? `${int(project.days.size)} active UTC days · ${observed}` : 'No named project activity' },
		{ label: 'Busiest machine', value: machine ? options.redact ? 'Machine hidden' : options.machineNames?.get(machine[0]) ?? 'Unnamed machine' : 'Unavailable', detail: machine ? `${int(machine[1])} observed usage records${partial ? ' · Partial history' : ''}` : 'No machine-attributed activity' },
		{ label: 'Most-used model', value: model ? options.redact ? 'Model hidden' : model[0] : 'Unavailable', detail: model ? `${int(model[1])} observed usage records${partial ? ' · Partial history' : ''}` : 'No observed usage' }
	];
	return { year: options.year, yearToDate: options.year === currentYear, from, to, availableFrom: days[0] ?? null, availableTo: days.at(-1) ?? null,
		scope: options.scope, partial, activityPartial, headline, comparisonUnknownRequests: grain.filter(row => (row.provider === 'claude' || row.provider === 'codex') && options.fees[row.provider].enabled).reduce((sum, row) => sum + row.costUnknownRequests, 0), comparison: buildWindowSubsidisation(grain, options.fees, { from, to }).combined, highlights };
}
