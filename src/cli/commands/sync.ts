import { hostname } from 'node:os';
import {
	getSyncStatus,
	performSyncAction,
	setSyncInterval
} from '../../lib/core/sync/manager.js';
import type { SyncStatus } from '../../lib/core/sync/types.js';

export async function runSync(argv: string[]): Promise<void> {
	const [command = 'status', ...rest] = argv;
	if (command === 'status') {
		const status = await getSyncStatus();
		if (rest.includes('--json')) console.log(JSON.stringify(status, null, 2));
		else printStatus(status);
		return;
	}
	if (command === 'create') {
		const status = await performSyncAction({
			action: 'create',
			databaseUrl: databaseUrl(rest),
			poolName: requiredFlag(rest, '--name'),
			machineName: flag(rest, '--machine') ?? hostname()
		});
		console.log(`created pool ${status.pool?.name} (${status.pool?.id})`);
		console.log(
			`machine ${status.machine?.name} joined; it now publishes aggregates to the shared pool (local SQLite keeps running)`
		);
		if (status.error) console.error(`warning: ${status.error}`);
		return;
	}
	if (command === 'interval') {
		const raw = rest[0];
		if (!raw) throw new Error('usage: chaching sync interval <minutes> (whole number >= 1)');
		const saved = await setSyncInterval(Number(raw));
		console.log(`sync interval set to ${saved} min`);
		console.log(
			'higher = cheaper on serverless Postgres (fewer wake windows); only peers’ data goes staler, your own numbers stay live'
		);
		return;
	}
	if (command === 'join') {
		const status = await performSyncAction({
			action: 'join',
			databaseUrl: databaseUrl(rest),
			poolId: requiredFlag(rest, '--pool'),
			machineName: flag(rest, '--machine') ?? hostname()
		});
		console.log(`joined pool ${status.pool?.name} (${status.pool?.id}) as ${status.machine?.name}`);
		if (status.error) console.error(`warning: ${status.error}`);
		return;
	}
	if (command === 'leave') {
		await performSyncAction({ action: 'leave' });
		console.log(
			'left sync pool; this machine is local-only again. Your own history is intact (local SQLite never stopped); peers’ machines are simply no longer visible until you rejoin'
		);
		return;
	}
	if (command === 'subscription' && rest[0] === 'add') {
		const args = rest.slice(1);
		const status = await performSyncAction({
			action: 'add-subscription',
			provider: requiredFlag(args, '--provider'),
			name: requiredFlag(args, '--name'),
			account: flag(args, '--account') ?? '',
			tier: flag(args, '--tier') ?? 'custom',
			monthlyUsd: numberFlag(args, '--monthly-usd')
		});
		const added = status.subscriptions.at(-1);
		console.log(`added subscription ${added?.name ?? ''} (${added?.id ?? 'created'})`);
		return;
	}
	if (command === 'map') {
		const status = await getSyncStatus();
		if (!status.machine) throw new Error('Join or create a sync pool first');
		await performSyncAction({
			action: 'map',
			machineId: flag(rest, '--machine') ?? status.machine.id,
			provider: requiredFlag(rest, '--provider'),
			subscriptionId: nullableFlag(rest, '--subscription')
		});
		console.log('subscription mapping saved');
		return;
	}
	throw new Error(
		'chaching sync: expected create|join|status|leave|interval|subscription add|map (run chaching --help)'
	);
}

function printStatus(status: SyncStatus): void {
	if (!status.enabled) {
		console.log('Chaching Sync: local only (SQLite history)');
		if (status.error) console.log(`sync error: ${status.error}`);
		return;
	}
	if (!status.pool || !status.machine) {
		console.log('Chaching Sync: configured but unavailable');
		if (status.error) console.log(`sync error: ${status.error}`);
		return;
	}
	console.log(`Chaching Sync: ${status.pool.name} (${status.pool.id})`);
	console.log(`This machine: ${status.machine.name} (${status.machine.id})`);
	console.log(`Machines: ${status.machines.map((machine) => machine.name).join(', ') || 'none'}`);
	console.log(`Subscriptions: ${status.subscriptions.map((sub) => sub.name).join(', ') || 'none'}`);
	if (typeof status.intervalMinutes === 'number') {
		console.log(`Publish interval: ${status.intervalMinutes} min (peers refresh at most this often)`);
	}
	// The roster's last-seen timestamps double as each machine's last-burst signal.
	const seen = status.machine.lastSeenAt;
	if (seen) console.log(`This machine last published: ${new Date(seen).toLocaleString()}`);
}

function flag(argv: string[], name: string): string | null {
	const exact = argv.indexOf(name);
	if (exact !== -1) {
		const value = argv[exact + 1];
		if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
		return value;
	}
	const prefix = `${name}=`;
	const inline = argv.find((arg) => arg.startsWith(prefix));
	return inline ? inline.slice(prefix.length) : null;
}

function requiredFlag(argv: string[], name: string): string {
	const value = flag(argv, name)?.trim();
	if (!value) throw new Error(`${name} is required`);
	return value;
}

function nullableFlag(argv: string[], name: string): string | null {
	const value = requiredFlag(argv, name);
	return value === 'none' || value === 'null' ? null : value;
}

function numberFlag(argv: string[], name: string): number {
	const raw = requiredFlag(argv, name);
	const value = Number(raw);
	if (!Number.isFinite(value) || value < 0) throw new Error(`${name} must be a non-negative number`);
	return value;
}

function databaseUrl(argv: string[]): string {
	const value = flag(argv, '--database-url') ?? process.env.CHACHING_DATABASE_URL ?? '';
	if (!value.trim())
		throw new Error('Set CHACHING_DATABASE_URL or pass --database-url (visible in shell history)');
	return value.trim();
}
