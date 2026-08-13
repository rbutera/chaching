import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
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

interface QuotaRow {
	id: string;
	account_payload: string;
	observed_at: string;
	usage_payload: string;
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

export function readTokenmaxxQuota(dbPath: string): TokenmaxxQuotaSnapshot | null {
	if (!existsSync(dbPath)) return null;

	const db = new DatabaseSync(dbPath, { readOnly: true });
	try {
		const tables = db.prepare(`
			SELECT COUNT(*) AS count FROM sqlite_master
			WHERE type = 'table' AND name IN ('accounts', 'usage_snapshots')
		`).get() as { count: number } | undefined;
		if (Number(tables?.count) !== 2) return null;
		const rows = db.prepare(`
			SELECT a.id, a.payload AS account_payload,
				u.observed_at, u.payload AS usage_payload
			FROM accounts a
			JOIN usage_snapshots u ON u.account_id = a.id
			WHERE a.provider = 'anthropic'
			ORDER BY a.id
		`).all() as unknown as QuotaRow[];
		if (rows.length === 0) return null;

		const accounts = rows.map((row, index): ProviderQuotaAccount => {
			const account = JSON.parse(row.account_payload) as { plan?: unknown };
			const usage = JSON.parse(row.usage_payload) as {
				hardLimitReached?: unknown;
				windows?: Array<{ id?: unknown; label?: unknown; usedPercent?: unknown; resetAt?: unknown }>;
			};
			return {
				label: `Claude account ${index + 1}`,
				provider: 'claude',
				plan: typeof account.plan === 'string' ? account.plan : null,
				hardLimitReached: usage.hardLimitReached === true,
				windows: (usage.windows ?? [])
					.filter((window) => typeof window.id === 'string' && typeof window.usedPercent === 'number')
					.map((window) => ({
						id: String(window.id),
						label: typeof window.label === 'string' ? window.label : String(window.id),
						usedPercent: Number(window.usedPercent),
						resetAt: typeof window.resetAt === 'string' ? window.resetAt : null
					}))
			};
		});
		return {
			observedAt: rows.reduce((latest, row) => row.observed_at > latest ? row.observed_at : latest, ''),
			accounts
		};
	} finally {
		db.close();
	}
}
