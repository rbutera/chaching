import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { binLauncher, createCliFixture, runNode } from './cli-test-harness';

// A headless `chaching serve` (a systemd unit nobody browses) must publish to its pool
// after a restart. It used to connect sync only inside the first HTTP request's lazy
// engine start, so a server nobody opened never published at all.

const databaseUrl = process.env.CHACHING_TEST_DATABASE_URL;
const buildEntry = join(process.env.CHACHING_PACKAGE_ROOT!, 'server', 'index.js');
const suite = databaseUrl && existsSync(buildEntry) ? describe : describe.skip;

suite('chaching serve publishes to its sync pool at boot', () => {
	const databaseName = `chaching_serve_${randomUUID().replaceAll('-', '')}`;
	const fx = createCliFixture();
	let admin: Pool;
	let url: string;

	beforeAll(async () => {
		admin = new Pool({ connectionString: databaseUrl });
		await admin.query(`CREATE DATABASE ${databaseName}`);
		const target = new URL(databaseUrl!);
		target.pathname = `/${databaseName}`;
		url = target.href;
	});
	afterAll(async () => {
		await admin?.query(`DROP DATABASE IF EXISTS ${databaseName} WITH (FORCE)`);
		await admin?.end();
		fx.cleanup();
	});

	it('publishes with no HTTP request made', async () => {
		const env = { ...fx.env, CHACHING_DATABASE_URL: url };
		const created = await runNode(binLauncher, ['sync', 'create', '--name', 'Serve boot', '--machine', 'headless'], { env });
		expect(created.code, created.stderr).toBe(0);
		const lastPublished = async () => {
			const status = await runNode(binLauncher, ['sync', 'status', '--json'], { env });
			expect(status.code, status.stderr).toBe(0);
			return (JSON.parse(status.stdout) as { machine?: { lastPublishedAt?: string | null } }).machine?.lastPublishedAt ?? null;
		};
		// Joining stamps a heartbeat, never a publish.
		expect(await lastPublished()).toBeNull();

		const port = 43000 + Math.floor(Math.random() * 2000);
		const child = spawn('node', [binLauncher, 'serve', '--no-art'], {
			env: { ...process.env, ...env, PORT: String(port), CHACHING_NO_ART: '1', CHACHING_NO_OPEN: '1' },
			stdio: ['ignore', 'pipe', 'pipe']
		});
		let output = '';
		child.stdout.on('data', (d) => (output += d.toString()));
		child.stderr.on('data', (d) => (output += d.toString()));
		try {
			// Well inside the first aligned sync slot (15 min): only a boot-time connect publishes this soon.
			let published: string | null = null;
			const deadline = Date.now() + 20_000;
			while (!published && Date.now() < deadline) {
				published = await lastPublished();
				if (!published) await new Promise((r) => setTimeout(r, 500));
			}
			expect(published, `serve output:\n${output}`).not.toBeNull();
		} finally {
			child.kill('SIGKILL');
		}
	}, 60_000);
});
