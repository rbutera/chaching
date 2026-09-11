import { hostname } from 'node:os';
import { PostgresSyncStore, SCHEMA_VERSION } from '../../lib/core/sync/store.js';
import {
	getSyncStatus,
	performSyncAction,
	setSyncInterval
} from '../../lib/core/sync/manager.js';
import type { SyncStatus } from '../../lib/core/sync/types.js';

export async function runSync(argv: string[]): Promise<void> {
	const [command = 'status', ...rest] = argv;
	if (command === 'schema') {
		if (rest.some(arg => arg !== '--migrate' && arg !== '--clients-stopped'))
			throw new Error('usage: CHACHING_DATABASE_URL=<url> chaching sync schema [--migrate --clients-stopped]');
		if (rest.includes('--migrate') && !rest.includes('--clients-stopped'))
			throw new Error('Stop every client sharing this database and complete the rollout backups before using --migrate --clients-stopped.');
		const store = new PostgresSyncStore(databaseUrl([]));
		try {
			const before = await store.readSchemaVersion();
			if (rest.includes('--migrate')) {
				if (before !== 3 && before !== SCHEMA_VERSION)
					throw new Error(`Schema migration requires version 3 or ${SCHEMA_VERSION}; found ${before ?? 'missing'}.`);
				await store.open();
			}
			console.log(JSON.stringify({ before, version: await store.readSchemaVersion(), target: SCHEMA_VERSION }));
		} finally { await store.close(); }
		return;
	}
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
	if ((command === 'account' || command === 'subscription') && rest[0] === 'add') {
		const args = rest.slice(1);
		const existingIds = new Set((await getSyncStatus()).accounts.map(({ id }) => id));
		const status = await performSyncAction({
			action: 'add-account',
			provider: requiredFlag(args, '--provider'),
			name: requiredFlag(args, '--name'),
			account: flag(args, '--account') ?? '',
			tier: flag(args, '--tier') ?? 'custom',
			monthlyUsd: numberFlag(args, '--monthly-usd')
		});
		const added = status.accounts.find(({ id }) => !existingIds.has(id));
		console.log(`added Account ${added?.name ?? ''} (${added?.id ?? 'created'})`);
		return;
	}
	if (command === 'map') {
		const status = await getSyncStatus();
		if (!status.machine) throw new Error('Join or create a sync pool first');
		await performSyncAction({
			action: 'map',
			machineId: flag(rest, '--machine') ?? status.machine.id,
			provider: requiredFlag(rest, '--provider'),
			accountId: nullableFlag(rest,
				rest.some((arg) => arg === '--account' || arg.startsWith('--account='))
					? '--account'
					: '--subscription')
		});
		console.log('Account mapping saved');
		return;
	}
	throw new Error(
		'chaching sync: expected create|join|status|schema|leave|interval|account add|map (run chaching --help)'
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
	console.log(`Accounts: ${status.accounts.map((sub) => sub.name).join(', ') || 'none'}`);
	if (typeof status.intervalMinutes === 'number') {
		console.log(`Publish interval: ${status.intervalMinutes} min (peers refresh at most this often)`);
	}
	// "Last seen" (heartbeat) and "last published" (a real publish burst) are distinct signals
	// now — report each truthfully rather than passing the heartbeat off as a publish (C10).
	const seen = status.machine.lastSeenAt;
	if (seen) console.log(`This machine last seen: ${new Date(seen).toLocaleString()}`);
	const published = status.machine.lastPublishedAt;
	console.log(
		`This machine last published: ${published ? new Date(published).toLocaleString() : 'not yet'}`
	);
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
