import type { UsageRecord } from '../../types';

const SEP = '\u001f';

/** Source keys are only machine-local; namespace them inside a pooled ledger. */
export function usageDedupKey(record: Pick<UsageRecord, 'key' | 'machineId'>): string {
	// Cursor Admin API events are cloud-account events. Every configured machine sees
	// the same key, so they must deduplicate pool-wide. Local bridge events use
	// `opencode:*` keys and remain machine-scoped.
	if (isPoolGlobalUsage(record)) return record.key;
	return record.machineId ? `${record.machineId}${SEP}${record.key}` : record.key;
}

export function isPoolGlobalUsage(record: Pick<UsageRecord, 'key'>): boolean {
	return record.key.startsWith('cursor:');
}
