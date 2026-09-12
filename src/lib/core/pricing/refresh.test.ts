import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PricingRefresh } from './refresh';

const dirs: string[] = [];
const servers: Server[] = [];
const clients: PricingRefresh<number>[] = [];
afterEach(async () => {
	for (const client of clients.splice(0)) client.dispose();
	await Promise.all(servers.splice(0).map(server => new Promise<void>(resolve => { server.closeAllConnections(); server.close(() => resolve()); })));
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});
async function fixture() {
	const dir = mkdtempSync(join(tmpdir(), 'pricing-refresh-')); dirs.push(dir);
	let requests = 0;
	let value = '2';
	let conditional = false;
	let hang = false;
	let delay = 0;
	const server = createServer((req, res) => {
		requests++;
		if (hang) return;
		if (conditional && req.headers['if-none-match'] === 'fixture') { res.writeHead(304); res.end(); return; }
		res.setHeader('ETag', 'fixture');
		if (delay) setTimeout(() => res.end(value), delay); else res.end(value);
	});
	servers.push(server);
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
	const address = server.address();
	if (!address || typeof address === 'string') throw new Error('No fixture port');
	const url = `http://127.0.0.1:${address.port}`;
	let now = 10000000;
	const installed: unknown[] = [];
	const validate = (input: unknown) => {
		if (typeof input !== 'number' || !Number.isFinite(input) || input < 0) throw new Error('invalid price');
		return input;
	};
	const make = () => {
		const client = new PricingRefresh({ dataDir: dir, normalizationVersion: 1, urls: {litellm:url, modelsdev:url}, now: () => now, normalize: (_source, input) => validate(input), validate, onCatalog: catalog => installed.push(catalog) });
		clients.push(client); return client;
	};
	return { dir, make, installed, requests: () => requests, advance: (ms: number) => {now += ms;}, payload: (input: string) => {value = input;}, conditional: () => {conditional = true;}, hang: () => {hang = true;}, delay: (ms: number) => {delay = ms;} };
}
describe('pricing refresh lifecycle', () => {
	it('coalesces bursts, persists cooldown, checks daily and conditionally revalidates', async () => {
		const f = await fixture(); const a = f.make();
		expect(await Promise.all([a.refresh(), a.refresh({exactMiss:true}), a.refresh()])).toEqual([true,true,true]);
		expect(f.requests()).toBe(2);
		const b = f.make(); expect(b.loadCached()).toBe(true);
		expect(await b.refresh({exactMiss:true})).toBe(false);
		f.advance(30 * 60 * 1000); f.conditional();
		expect(await b.refresh()).toBe(false);
		expect(await b.refresh({exactMiss:true})).toBe(true);
		f.advance(24 * 60 * 60 * 1000);
		expect(await b.refresh()).toBe(true);
		expect(f.requests()).toBe(6);
		expect(f.installed.at(-1)).toEqual({litellm:2,modelsdev:2});
	});
	it('keeps last good data after invalid responses and persists failed attempt cooldown', async () => {
		const f = await fixture(); const a = f.make(); await a.refresh();
		f.advance(24 * 60 * 60 * 1000); f.payload('-1');
		expect(await a.refresh()).toBe(false);
		const b = f.make(); b.loadCached();
		expect(f.installed.at(-1)).toEqual({litellm:2,modelsdev:2});
		expect(await b.refresh({exactMiss:true})).toBe(false);
		expect(f.requests()).toBe(4);
	});
	it('cancels disposal', async () => {
		const f = await fixture(); const a = f.make(); f.hang();
		const request = a.refresh();
		await new Promise(resolve => setTimeout(resolve, 30));
		a.dispose(); expect(await request).toBe(false);
		expect(await a.refresh()).toBe(false);
		expect(f.installed).toEqual([]);
	});
	it('discards a stale fetch when another writer promotes a generation', async () => {
		const f = await fixture(); const a = f.make(); f.delay(60);
		const pending = a.refresh();
		await new Promise(resolve => setTimeout(resolve, 20));
		const path = join(f.dir, 'pricing-cache.json');
		const cache: { generation: string } = JSON.parse(readFileSync(path, 'utf8'));
		cache.generation = 'newer-writer'; writeFileSync(path, JSON.stringify(cache));
		await pending;
		expect(readFileSync(path, 'utf8')).toContain('newer-writer');
		expect(f.installed.at(-1)).toEqual({});
	});
	it('bounds oversized responses and never promotes them', async () => {
		const f = await fixture(); const a = f.make(); f.payload(' '.repeat(33 * 1024 * 1024));
		expect(await a.refresh()).toBe(false);
		expect(f.installed).toEqual([]);
	});
	it('bounds both stalled sources to one five-second command deadline', async () => {
		const f = await fixture(); const a = f.make(); f.hang();
		const start = Date.now();
		expect(await a.refresh()).toBe(false);
		expect(Date.now() - start).toBeLessThan(5500);
	}, 7000);

	it('does not break a live process lock and recovers dead writers', async () => {
		const f = await fixture(); const a = f.make();
		symlinkSync(String(process.pid), join(f.dir, 'pricing-cache.json.lock'));
		expect(await a.refresh()).toBe(false); expect(f.requests()).toBe(0);
		rmSync(join(f.dir, 'pricing-cache.json.lock'));
		symlinkSync('2147483647', join(f.dir, 'pricing-cache.json.lock'));
		expect(await a.refresh()).toBe(true);
	});
	it('rejects a corrupted persisted catalog and accepts explicit free prices', async () => {
		const f = await fixture(); const a = f.make(); f.payload('0'); await a.refresh();
		expect(f.installed.at(-1)).toEqual({litellm:0,modelsdev:0});
		const path = join(f.dir,'pricing-cache.json');
		writeFileSync(path, readFileSync(path,'utf8').replaceAll('"catalog":0','"catalog":-1'));
		f.make().loadCached(); expect(f.installed.at(-1)).toEqual({});
	});
});
