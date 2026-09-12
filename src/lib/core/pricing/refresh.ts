import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, readlinkSync, renameSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type PricingSource = 'litellm' | 'modelsdev';
const URLS = {
	litellm: 'https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json',
	modelsdev: 'https://models.dev/api.json'
};
const DAY = 24 * 60 * 60 * 1000;
const COOLDOWN = 30 * 60 * 1000;
const MAX_BYTES = 32 * 1024 * 1024;
interface SourceCache<T> {
	url: string;
	checkedAt: number;
	hash: string;
	etag: string | null;
	lastModified: string | null;
	catalog: T;
}
interface Cache<T> {
	version: number;
	generation: string;
	attemptedAt: number;
	sources: Partial<Record<PricingSource, SourceCache<T>>>;
}
export interface PricingRefreshOptions<T> {
	dataDir: string;
	normalizationVersion: number;
	normalize: (source: PricingSource, payload: unknown, previous: T | null, revision: string) => T;
	validate: (catalog: unknown) => T;
	onCatalog: (catalogs: Partial<Record<PricingSource, T>>) => void;
	urls?: Record<PricingSource, string>;
	now?: () => number;
}
function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Network and disk ownership stays with the engine; normalized catalogs remain browser-safe. */
export class PricingRefresh<T> {
	private readonly path: string;
	private readonly lock: string;
	private readonly urls: Record<PricingSource, string>;
	private readonly controller = new AbortController();
	private pending: Promise<boolean> | null = null;
	private installed = '';
	constructor(private readonly options: PricingRefreshOptions<T>) {
		this.path = join(options.dataDir, 'pricing-cache.json');
		this.lock = `${this.path}.lock`;
		this.urls = options.urls ?? URLS;
	}
	private now() { return (this.options.now ?? Date.now)(); }
	private empty(): Cache<T> {
		return { version: this.options.normalizationVersion, generation: '', attemptedAt: 0, sources: {} };
	}
	private read(): Cache<T> {
		try {
			const value: unknown = JSON.parse(readFileSync(this.path, 'utf8'));
			if (!object(value) || value.version !== this.options.normalizationVersion || typeof value.generation !== 'string' || typeof value.attemptedAt !== 'number' || !Number.isFinite(value.attemptedAt) || !object(value.sources)) return this.empty();
			const cache = this.empty();
			cache.generation = value.generation;
			cache.attemptedAt = value.attemptedAt;
			for (const source of ['litellm', 'modelsdev'] satisfies PricingSource[]) {
				const row = value.sources[source];
				if (!object(row) || row.url !== this.urls[source] || typeof row.checkedAt !== 'number' || !Number.isFinite(row.checkedAt) || typeof row.hash !== 'string' || !(row.etag === null || typeof row.etag === 'string') || !(row.lastModified === null || typeof row.lastModified === 'string')) continue;
				try { cache.sources[source] = { url: row.url, checkedAt: row.checkedAt, hash: row.hash, etag: row.etag, lastModified: row.lastModified, catalog: this.options.validate(row.catalog) }; } catch { /* Keep other independently valid sources. */ }
			}
			return cache;
		} catch { return this.empty(); }
	}
	private install(cache: Cache<T>): boolean {
		if (cache.generation === this.installed) return false;
		this.installed = cache.generation;
		this.options.onCatalog(Object.fromEntries(Object.entries(cache.sources).map(([source, row]) => [source, row.catalog])));
		return true;
	}
	loadCached(): boolean { return this.install(this.read()); }
	private write(cache: Cache<T>): void {
		const temp = `${this.path}.${randomUUID()}.tmp`;
		try {
			writeFileSync(temp, JSON.stringify(cache), { mode: 0o600 });
			renameSync(temp, this.path);
		} finally { try { unlinkSync(temp); } catch { /* rename consumed it */ } }
	}
	private locked<R>(operation: () => R): R | undefined {
		mkdirSync(this.options.dataDir, { recursive: true });
		const owner = String(process.pid);
		try { symlinkSync(owner, this.lock); } catch {
			try {
				const pid = Number(readlinkSync(this.lock));
				if (!Number.isSafeInteger(pid) || pid <= 0) return;
				try { process.kill(pid, 0); return; } catch (error) {
					if (!object(error) || error.code !== 'ESRCH') return;
				}
				unlinkSync(this.lock);
				symlinkSync(owner, this.lock);
			} catch { return; }
		}
		try { return operation(); } finally { unlinkSync(this.lock); }
	}
	refresh({ exactMiss = false, signal }: { exactMiss?: boolean; signal?: AbortSignal } = {}): Promise<boolean> {
		if (this.pending) return this.pending;
		if (this.controller.signal.aborted || signal?.aborted) return Promise.resolve(false);
		this.pending = this.run(exactMiss, signal).catch(() => false).finally(() => { this.pending = null; });
		return this.pending;
	}
	private async run(exactMiss: boolean, callerSignal?: AbortSignal): Promise<boolean> {
		const signal = AbortSignal.any([this.controller.signal, AbortSignal.timeout(5000), ...(callerSignal ? [callerSignal] : [])]);
		const started = this.locked(() => {
			const cache = this.read();
			this.install(cache);
			const now = this.now();
			if (cache.attemptedAt && now - cache.attemptedAt < COOLDOWN) return null;
			if (!exactMiss && Object.values(this.urls).every(url => Object.values(cache.sources).some(row => row.url === url && now - row.checkedAt < DAY))) return null;
			cache.attemptedAt = now;
			cache.generation = randomUUID();
			this.write(cache);
			return cache;
		});
		if (!started) return false;
		const results = await Promise.allSettled((['litellm', 'modelsdev'] satisfies PricingSource[]).map(async source => {
			const old = started.sources[source];
			const headers = new Headers();
			if (old?.etag) headers.set('If-None-Match', old.etag);
			if (old?.lastModified) headers.set('If-Modified-Since', old.lastModified);
			const response = await fetch(this.urls[source], { headers, signal });
			if (response.status === 304 && old) return { source, row: { ...old, checkedAt: this.now() } };
			if (!response.ok || !response.body) throw new Error('Catalog request failed');
			const reader = response.body.getReader();
			const chunks: Uint8Array[] = [];
			let size = 0;
			try {
				for (;;) {
					const { value, done } = await reader.read();
					if (done) break;
					size += value.byteLength;
					if (size > MAX_BYTES) throw new Error('Catalog response too large');
					chunks.push(value);
				}
			} finally { await reader.cancel().catch(() => {}); }
			const bytes = Buffer.concat(chunks);
			const payload: unknown = JSON.parse(bytes.toString('utf8'));
			const hash = createHash('sha256').update(bytes).digest('hex');
			const catalog = this.options.normalize(source, payload, old?.catalog ?? null, hash);
			return { source, row: { url: this.urls[source], checkedAt: this.now(), hash, etag: response.headers.get('etag'), lastModified: response.headers.get('last-modified'), catalog } };
		}));
		if (signal.aborted) return false;
		return this.locked(() => {
			const current = this.read();
			if (current.generation !== started.generation) return this.install(current);
			let accepted = false;
			for (const result of results) if (result.status === 'fulfilled') {
				current.sources[result.value.source] = result.value.row;
				accepted = true;
			}
			if (!accepted) return false;
			current.generation = randomUUID();
			this.write(current);
			return this.install(current);
		}) ?? false;
	}
	dispose(): void { this.controller.abort(); }
}
