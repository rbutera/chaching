export interface SyncMachineView {
	id: string;
	name: string;
	hostname: string;
	lastSeenAt: string | null;
	current?: boolean;
}

export interface SyncSubscriptionView {
	id: string;
	provider: string;
	name: string;
	account: string;
	tier: string;
	monthlyUsd: number;
}

export interface SyncMappingView {
	machineId: string;
	provider: string;
	subscriptionId: string | null;
}

export interface SyncStatusView {
	enabled: boolean;
	databaseConfigured: boolean;
	pool: { id: string; name: string } | null;
	machine: SyncMachineView | null;
	machines: SyncMachineView[];
	subscriptions: SyncSubscriptionView[];
	mappings: SyncMappingView[];
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
