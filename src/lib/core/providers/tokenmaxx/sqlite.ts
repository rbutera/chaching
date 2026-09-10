import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
import type { PrivateAccount } from '../../accounts';
import type { TokenCounts } from '../../../types';
import type { ProviderQuotaAccount } from '../../sync/types';

export interface TokenmaxxAggregate {
	day: string;
	provider: 'claude' | 'codex';
	model: string;
	tokens: TokenCounts;
	requests: number;
	firstTs: number;
	lastTs: number;
}

interface AggregateRow {
	day: string;
	provider: string;
	model: string | null;
	input_tokens: number;
	output_tokens: number;
	cache_read_tokens: number;
	cache_creation_tokens: number;
	requests: number;
	first_ts: number;
	last_ts: number;
}

const accountSchema = z.object({
	plan: z.string().nullable().optional(),
	externalAccountId: z.string().trim().min(1).nullable().optional(),
	externalUserId: z.string().trim().min(1).nullable().optional()
});
const quotaWindowSchema = z.object({
	id: z.string().min(1),
	label: z.string(),
	usedPercent: z.number().finite().min(0).max(100),
	resetAt: z.string().datetime({ offset: true }).nullable()
});
const usageSchema = z.object({
	hardLimitReached: z.boolean(),
	windows: z.array(z.unknown())
});
const quotaRowSchema = z.object({
	id: z.string(),
	provider: z.enum(['anthropic', 'openai']),
	account_payload: z.string(),
	observed_at: z.string().nullable(),
	usage_payload: z.string().nullable()
});

function parseJson(value: string): unknown {
	try { return JSON.parse(value); } catch { return null; }
}

export interface TokenmaxxQuotaSnapshot {
	observedAt: string | null;
	accounts: ProviderQuotaAccount[];
}

export function readTokenmaxxAggregates(dbPath: string): TokenmaxxAggregate[] {
	if (!existsSync(dbPath)) return [];

	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const rows = db
			.prepare(`
				SELECT
					date(at / 1000, 'unixepoch') AS day,
					provider,
					model,
					SUM(input_tokens) AS input_tokens,
					SUM(output_tokens) AS output_tokens,
					SUM(cache_read_tokens) AS cache_read_tokens,
					SUM(cache_creation_tokens) AS cache_creation_tokens,
					COUNT(*) AS requests,
					MIN(at) AS first_ts,
					MAX(at) AS last_ts
				FROM token_events
				WHERE provider IN ('anthropic', 'openai')
				GROUP BY day, provider, model
				ORDER BY day, provider, model
			`)
			.all() as unknown as AggregateRow[];

		return rows.map((row) => ({
			day: row.day,
			provider: row.provider === 'anthropic' ? 'claude' : 'codex',
			model: row.model ?? 'unknown',
			tokens: {
				input: Number(row.input_tokens),
				output: Number(row.output_tokens),
				cacheCreation: Number(row.cache_creation_tokens),
				cacheRead: Number(row.cache_read_tokens)
			},
			requests: Number(row.requests),
			firstTs: Number(row.first_ts),
			lastTs: Number(row.last_ts)
		}));
	} finally {
		db.close();
	}
}

export interface DiscoveredAccount {
	registrationId: string;
	provider: 'claude' | 'codex';
	identity: PrivateAccount['identity'];
	plan: string | null;
	quota: ProviderQuotaAccount;
}

export function accountIdentityKey(provider: string, identity: NonNullable<PrivateAccount['identity']>, scope: string): string {
	return `v1:${createHash('sha256').update(JSON.stringify([
		'chaching-account-v1', scope, provider, identity.accountId, provider === 'codex' ? identity.userId : null
	])).digest('hex')}`;
}

export function readTokenmaxxAccounts(dbPath: string, identityScope?: string): DiscoveredAccount[] {
	if (!existsSync(dbPath)) return [];
	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(row => row.name));
		if (!tables.has('accounts')) return [];
		const rows = db.prepare(tables.has('usage_snapshots') ? `
			SELECT a.id, a.provider, a.payload AS account_payload, u.observed_at, u.payload AS usage_payload
			FROM accounts a LEFT JOIN usage_snapshots u ON u.account_id = a.id
			WHERE a.provider IN ('anthropic', 'openai') ORDER BY a.id
		` : `
			SELECT id, provider, payload AS account_payload, NULL AS observed_at, NULL AS usage_payload
			FROM accounts WHERE provider IN ('anthropic', 'openai') ORDER BY id
		`).all().flatMap(row => {
			const parsed = quotaRowSchema.safeParse(row);
			return parsed.success ? [parsed.data] : [];
		});
		const active = new Map<string, string | null>();
		if (tables.has('provider_states')) {
			for (const row of db.prepare('SELECT payload FROM provider_states').all()) {
				if (typeof row.payload !== 'string') continue;
				const parsed = z.object({ provider: z.string(), activeAccountId: z.string().nullable() }).safeParse(parseJson(row.payload));
				if (parsed.success) active.set(parsed.data.provider, parsed.data.activeAccountId);
			}
		}
		return rows.flatMap((row, index): DiscoveredAccount[] => {
			const parsed = accountSchema.safeParse(parseJson(row.account_payload));
			if (!parsed.success) return [];
			const account = parsed.data;
			const provider = row.provider === 'anthropic' ? 'claude' : 'codex';
			const identity = account.externalAccountId && (provider === 'claude' || account.externalUserId)
				? { accountId: account.externalAccountId, userId: provider === 'codex' ? account.externalUserId ?? null : null }
				: null;
			const usage = usageSchema.safeParse(row.usage_payload === null ? null : parseJson(row.usage_payload));
			const date = z.string().datetime({ offset: true }).safeParse(row.observed_at);
			const observedAt = usage.success && date.success ? date.data : null;
			return [{
				registrationId: row.id, provider, identity, plan: account.plan ?? null,
				quota: {
					label: `${provider === 'claude' ? 'Claude' : 'Codex'} account ${index + 1}`,
					provider, plan: account.plan ?? null, observedAt,
					...(active.has(row.provider) ? { current: active.get(row.provider) === row.id } : {}),
					...(identityScope && identity ? { identityKey: accountIdentityKey(provider, identity, identityScope) } : {}),
					hardLimitReached: observedAt !== null && usage.success && usage.data.hardLimitReached,
					windows: observedAt !== null && usage.success ? usage.data.windows.flatMap(window => {
						const result = quotaWindowSchema.safeParse(window);
						return result.success ? [result.data] : [];
					}) : []
				}
			}];
		});
	} finally { db.close(); }
}

export function readTokenmaxxQuota(dbPath: string, identityScope?: string): TokenmaxxQuotaSnapshot | null {
	const accounts = readTokenmaxxAccounts(dbPath, identityScope).map(account => account.quota);
	if (!accounts.length) return null;
	const observations = accounts.flatMap(account => account.observedAt ? [account.observedAt] : []);
	return {
		observedAt: observations.sort((a, b) => Date.parse(b) - Date.parse(a))[0] ?? null,
		accounts
	};
}
