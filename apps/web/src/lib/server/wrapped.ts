import { hostname } from 'node:os';
import { error } from '@sveltejs/kit';
import { getReportAccountContext } from '@chaching/core/sync/manager';
import { buildYearlyWrapped } from '@chaching/receipt/wrapped/yearly';
import { getService } from './service';

export async function yearlyRecap(url: URL) {
	const year = Number(url.searchParams.get('year') ?? new Date().getUTCFullYear());
	if (!Number.isInteger(year) || year < 2000 || year > new Date().getUTCFullYear()) throw error(400, 'Choose a calendar year through the current year');
	const service = getService();
	await service.ensureStarted();
	const { status, fees, config } = await getReportAccountContext();
	if (status.enabled && (status.unreachable || service.stats.providerErrors.sync)) throw error(503, 'The pool is unavailable. Reconnect to view the pooled recap.');
	const snapshot = service.snapshot();
	if (status.enabled && snapshot.poolId !== status.pool?.id) throw error(503, 'The pooled recap is not ready. Reconnect to load the selected pool.');
	return buildYearlyWrapped(snapshot, { year, fees, scope: status.enabled ? 'All machines in your pool' : 'This machine',
		machineNames: new Map([[config.sync.machineId ?? hostname(), config.sync.machineName || hostname()], ...status.machines.map(machine => [machine.id, machine.name] satisfies [string, string])]),
		redact: url.searchParams.get('redact') === '1' });
}
