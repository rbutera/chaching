import { randomUUID } from 'node:crypto';
import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { loadConfig, publicConfig, updateConfig, type chachingConfig } from '$lib/core/config';
import { getService } from '$lib/server/service';

export const GET: RequestHandler = async () => {
	return json(publicConfig(await loadConfig()));
};

interface ConfigPatch {
	/** existing cutover write (unchanged behaviour) */
	cutoverTs?: number | null;
	/** Update a canonical Account, or create one when id is absent. */
	account?: { id?: unknown; provider?: unknown; name?: unknown; tier?: unknown; monthlyUsd?: unknown };
}

export const POST: RequestHandler = async ({ request }) => {
	const parsed: unknown = await request.json().catch(() => null);
	if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return json({ error: 'Expected a config patch.' }, { status: 400 });
	const body = parsed as ConfigPatch;
	const next = await updateConfig(cfg => {
		let next: chachingConfig = cfg;

		let cutoverTs = cfg.cutoverTs;
		if ('cutoverTs' in body) {
			cutoverTs = typeof body.cutoverTs === 'number' ? body.cutoverTs : null;
			next = { ...next, cutoverTs };
		}

		if (body.account) {
			const patch = body.account;
			const existing = next.accounts.find(account => account.id === patch.id);
			if (patch.id !== undefined && !existing) error(404, 'Account not found.');
			const provider = existing?.provider ?? patch.provider;
			if (provider !== 'claude' && provider !== 'codex') error(400, 'Unsupported provider.');
			const name = patch.name ?? existing?.name;
			const tier = patch.tier ?? existing?.tier;
			const monthlyUsd = patch.monthlyUsd === undefined ? existing?.monthlyUsd : patch.monthlyUsd;
			if (typeof name !== 'string' || !name.trim() || typeof tier !== 'string' || !tier ||
				(monthlyUsd !== null && (typeof monthlyUsd !== 'number' || !Number.isFinite(monthlyUsd) || monthlyUsd < 0))) {
				error(400, 'Enter an Account name, plan and nonnegative fee.');
			}
			const account = {
				id: existing?.id ?? randomUUID(), provider, name: name.trim(), tier, monthlyUsd,
				feeSource: patch.monthlyUsd === undefined && existing ? existing.feeSource : monthlyUsd === null ? 'inferred' as const : 'explicit' as const,
				identity: existing?.identity ?? null, registrations: existing?.registrations ?? [], legacy: existing?.legacy ?? false
			};
			next = {
				...next,
				accounts: existing ? next.accounts.map(item => item.id === account.id ? account : item) : [...next.accounts, account],
				providerAccounts: { ...next.providerAccounts, [provider]: [...new Set([...(next.providerAccounts[provider] ?? []), account.id])] }
			};
		}

		return next;
	});
	if ('cutoverTs' in body) getService().setCutover(next.cutoverTs);
	return json(publicConfig(next));
};
