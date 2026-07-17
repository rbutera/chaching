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
	| { action: 'import-history' }
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
