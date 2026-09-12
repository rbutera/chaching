import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const environment = { ...process.env, NX_DAEMON: 'false', CI: 'true' };
function run(command, args, capture = false) {
  const result = spawnSync(command, args, { env: environment, stdio: capture ? ['ignore', 'pipe', 'inherit'] : 'inherit', encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} exited ${result.status ?? result.signal}`);
  return result.stdout?.trim();
}
const pnpm = (...args) => run('pnpm', args);
rmSync('reports', { recursive: true, force: true });
mkdirSync('reports');
run(process.execPath, ['--test', 'tools/verify-ci-tests.test.mjs', 'tools/nx-cache-proxy.test.mjs']);
pnpm('boundaries');
pnpm('check');
pnpm('build');
run('git', ['diff', '--exit-code']);
const projects = JSON.parse(run('pnpm', ['exec', 'nx', 'show', 'projects', '--withTarget=test', '--json'], true));
if (!Array.isArray(projects) || !projects.length) throw new Error('Nx found no test projects');
for (const project of projects) {
  pnpm('exec', 'nx', 'run', `${project}:test`, '--skip-nx-cache', '--reporter=default', '--reporter=json', `--outputFile=${resolve('reports', `${project.replaceAll('/', '-')}.json`)}`);
}
run(process.execPath, ['tools/verify-ci-tests.mjs']);
pnpm('package');
rmSync('artifacts', { recursive: true, force: true });
mkdirSync('artifacts');
pnpm('--dir', 'dist/chaching', 'pack', '--pack-destination', resolve('artifacts'));
const tarballs = readdirSync('artifacts').filter(name => name.endsWith('.tgz'));
if (tarballs.length !== 1) throw new Error('Expected exactly one package tarball');
const archive = tarballs[0];
environment.CHACHING_PACKAGE_TARBALL = resolve('artifacts', archive);
pnpm('verify:package');
const manifest = JSON.parse(readFileSync('dist/chaching/package.json', 'utf8'));
writeFileSync('artifacts/manifest.json', JSON.stringify({
  sourceSha: run('git', ['rev-parse', 'HEAD'], true),
  name: manifest.name,
  version: manifest.version,
  archive,
  integrity: `sha512-${createHash('sha512').update(readFileSync(`artifacts/${archive}`)).digest('base64')}`,
  node: process.version,
  platform: process.platform,
  architecture: process.arch,
  runId: process.env.GITHUB_RUN_ID ?? null
}, null, 2) + '\n');

if (process.env.CHACHING_CI_SUBPATH === '1') {
  delete environment.CHACHING_PACKAGE_TARBALL;
  environment.CHACHING_BASE_PATH = '/ci-subpath';
  pnpm('build:sk');
  pnpm('package');
  pnpm('verify:package');
  run('git', ['diff', '--exit-code']);
}
