import type { SessionDay, UsageRecord } from '@chaching/shared/types';

export function sessionActivity(records: Iterable<UsageRecord>): Map<string, SessionDay[]> {
	const sessions = new Map<string, Map<string, SessionDay>>();
	for (const record of records) {
		if (record.key.startsWith('cursor:') || !record.sessionId) continue;
		const key = JSON.stringify([record.provider, record.sessionId]);
		const days = sessions.get(key) ?? new Map<string, SessionDay>();
		const dayKey = JSON.stringify([record.day, record.project]);
		const day = days.get(dayKey) ?? { day: record.day, project: record.project, requests: 0, cost: 0, costUnknownRequests: 0 };
		day.requests++;
		day.cost += record.cost ?? 0;
		day.costUnknownRequests += Number(record.cost === null);
		days.set(dayKey, day);
		sessions.set(key, days);
	}
	return new Map([...sessions].map(([key, days]) => [key, [...days.values()]]));
}
