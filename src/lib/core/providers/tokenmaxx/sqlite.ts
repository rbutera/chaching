import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { z } from 'zod';
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
	observed_at: z.string().datetime({ offset: true }),
	usage_payload: z.string()
});

function parseJson(value: string): unknown {
	try { return JSON.parse(value); } catch { return null; }
}

export interface TokenmaxxQuotaSnapshot {
	observedAt: string;
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

export function readTokenmaxxQuota(dbPath: string, identityScope?: string): TokenmaxxQuotaSnapshot | null {
	if (!existsSync(dbPath)) return null;

	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const tables = db.prepare(`
			SELECT COUNT(*) AS count FROM sqlite_master
			WHERE type = 'table' AND name IN ('accounts', 'usage_snapshots')
		`).get() as { count: number } | undefined;
		if (Number(tables?.count) !== 2) return null;
		const rows = db.prepare(`
			SELECT a.id, a.provider, a.payload AS account_payload,
				u.observed_at, u.payload AS usage_payload
			FROM accounts a
			JOIN usage_snapshots u ON u.account_id = a.id
			WHERE a.provider IN ('anthropic', 'openai')
			ORDER BY a.id
		`).all().flatMap(row => {
			const parsed = quotaRowSchema.safeParse(row);
			return parsed.success ? [parsed.data] : [];
		});
		if (rows.length === 0) return null;

		const active = new Map<string, string | null>();
		if (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'provider_states'").get()) {
			for (const row of db.prepare('SELECT payload FROM provider_states').all()) {
				if (typeof row.payload !== 'string') continue;
				const parsed = z.object({ provider: z.string(), activeAccountId: z.string().nullable() }).safeParse(parseJson(row.payload));
				if (parsed.success) active.set(parsed.data.provider, parsed.data.activeAccountId);
			}
		}
		const accounts = rows.flatMap((row, index): (ProviderQuotaAccount & { observedAt: string })[] => {
			const account = accountSchema.safeParse(parseJson(row.account_payload));
			const usage = usageSchema.safeParse(parseJson(row.usage_payload));
			if (!account.success || !usage.success) return [];
			const provider = row.provider === 'anthropic' ? 'claude' : 'codex';
			const identity = account.data;
			const canIdentify = identity.externalAccountId && (provider === 'claude' || identity.externalUserId);
			return [{
				label: `${provider === 'claude' ? 'Claude' : 'Codex'} account ${index + 1}`,
				provider,
				plan: identity.plan ?? null,
				observedAt: row.observed_at,
				...(active.has(row.provider) ? { current: active.get(row.provider) === row.id } : {}),
				...(identityScope && canIdentify ? {
					identityKey: `v1:${createHash('sha256').update(JSON.stringify([
						'chaching-account-v1', identityScope, provider, identity.externalAccountId,
						provider === 'codex' ? identity.externalUserId : null
					])).digest('hex')}`
				} : {}),
				hardLimitReached: usage.data.hardLimitReached,
				windows: usage.data.windows.flatMap(window => {
					const parsed = quotaWindowSchema.safeParse(window);
					return parsed.success ? [parsed.data] : [];
				})
			}];
		});
		if (accounts.length === 0) return null;
		return {
			observedAt: accounts.reduce((latest, account) => Date.parse(account.observedAt) > Date.parse(latest) ? account.observedAt : latest, accounts[0].observedAt),
			accounts
		};
	} finally {
		db.close();
	}
}
