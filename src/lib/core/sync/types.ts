export interface SyncMachine {
	id: string;
	name: string;
	hostname: string;
	lastSeenAt: string | null;
	current?: boolean;
}

export interface SyncSubscription {
	id: string;
	provider: string;
	name: string;
	account: string;
	tier: string;
	monthlyUsd: number;
}

export interface SyncMapping {
	machineId: string;
	provider: string;
	subscriptionId: string | null;
}

/**
 * Pool identity known from the local `0600` config alone, without reaching PostgreSQL.
 * Surfaced when sync is configured but the database is unreachable so a joined-but-offline
 * machine renders as "joined, pool unreachable" rather than falling back to onboarding.
 */
export interface SyncLocalIdentity {
	poolId: string;
	machineId: string;
	machineName: string;
}

export interface SyncStatus {
	enabled: boolean;
	databaseConfigured: boolean;
	pool: { id: string; name: string } | null;
	machine: SyncMachine | null;
	machines: SyncMachine[];
	subscriptions: SyncSubscription[];
	mappings: SyncMapping[];
	/** False when viewed through a remote/reverse-proxied dashboard. */
	managementAllowed?: boolean;
	/**
	 * Wall-clock-aligned publish cadence in minutes (config `sync.intervalMinutes`). Attached
	 * by `getSyncStatus` from the local config so the CLI/dashboard can show the cadence and
	 * its serverless trade-off. Absent on raw store payloads that never touch config.
	 */
	intervalMinutes?: number;
	/**
	 * True when sync is configured but PostgreSQL could not be reached for this status
	 * read. Pairs with `localIdentity` so the UI can show a distinct offline state.
	 */
	unreachable?: boolean;
	/** Locally-known pool identity, present when configured-but-unreachable. */
	localIdentity?: SyncLocalIdentity | null;
	error?: string | null;
}

export type SyncAction =
	| {
			action: 'create';
			databaseUrl: string;
			poolName: string;
			machineName: string;
	  }
	| {
			action: 'join';
			databaseUrl: string;
			poolId: string;
			machineName: string;
	  }
	| { action: 'leave' }
	| {
			action: 'add-subscription';
			provider: string;
			name: string;
			account: string;
			tier: string;
			monthlyUsd: number;
	  }
	| {
			action: 'map';
			machineId: string;
			provider: string;
			subscriptionId: string | null;
	  };
