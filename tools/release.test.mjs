import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { bump, integrity, packageContents, run, validateArtifact, validateGateJobs } from './release.mjs';

test('version allocation and every mandatory gate result', () => {
  assert.equal(bump('1.18.9', 'patch'), '1.18.10');
  assert.equal(bump('1.18.9', 'minor'), '1.19.0');
  assert.equal(bump('1.18.9', 'major'), '2.0.0');
  assert.throws(() => bump('1.18.9', 'invalid'));
  assert.throws(() => bump('1.18.9-beta', 'patch'));
  const jobs = ['Linux / Node 24.16.0', 'Linux / Node 26.7.0', 'macOS / Node 26.7.0', 'Required CI gate'].map(name => ({ name: `gate / ${name}`, conclusion: 'success' }));
  validateGateJobs(jobs);
  assert.throws(() => validateGateJobs(jobs.slice(1)));
  for (const conclusion of ['failure', 'skipped', 'cancelled', null]) {
    assert.throws(() => validateGateJobs(jobs.map((job, i) => i === 0 ? { ...job, conclusion } : job)));
  }
  assert.throws(() => validateGateJobs([...jobs, jobs[0]]));
});

test('release failures retain one version through atomic promotion, upload, publication and recovery', () => {
  const temp = mkdtempSync(join(tmpdir(), 'chaching-release-test-'));
  const script = resolve('tools/release.mjs');
  const root = join(temp, 'repo');
  const remote = join(temp, 'remote.git');
  const bin = join(temp, 'bin');
  mkdirSync(root);
  mkdirSync(bin);
  const git = (...args) => run('git', args, { cwd: root });
  const save = (path, value) => writeFileSync(join(root, path), JSON.stringify(value));
  try {
    run('git', ['init', '--bare', remote]);
    git('init', '-b', 'main');
    git('config', 'user.name', 'Test');
    git('config', 'user.email', 'test@example.com');
    mkdirSync(join(root, '.github/workflows'), { recursive: true });
    writeFileSync(join(root, '.github/workflows/ci.yml'), 'test gate');
    save('package.json', { name: 'chaching-workspace', version: '1.18.0' });
    writeFileSync(join(root, 'CHANGELOG.md'), 'old notes\n');
    git('add', '.'); git('commit', '-m', 'initial');
    git('remote', 'add', 'origin', remote); git('push', '-u', 'origin', 'main');
    const parentSha = git('rev-parse', 'HEAD');
    const version = '1.18.1';
    save('package.json', { name: 'chaching-workspace', version });
    const notes = '## 1.18.1\n\nTest changes';
    writeFileSync(join(root, 'CHANGELOG.md'), notes + '\n\nold notes\n');
    git('add', '.'); git('commit', '-m', `chore(release): ${version}`);
    const sourceSha = git('rev-parse', 'HEAD');
    git('push', 'origin', 'HEAD:refs/heads/release-candidate/test');
    mkdirSync(join(root, 'artifacts'));
    mkdirSync(join(root, 'package'));
    save('package/package.json', { name: 'chaching', version, repository: { url: 'git+https://github.com/rbutera/chaching.git' } });
    const archive = `chaching-${version}.tgz`;
    const archivePath = join(root, 'artifacts', archive);
    run('tar', ['-czf', archivePath, 'package/package.json'], { cwd: root });
    const manifest = { name: 'chaching', version, archive, sourceSha, integrity: integrity(readFileSync(archivePath)), contents: packageContents(archivePath), platform: 'linux', node: 'v26.7.0', runId: '42' };
    validateArtifact(manifest, join(root, 'artifacts'));
    assert.throws(() => validateArtifact({ ...manifest, integrity: 'sha512-wrong' }, join(root, 'artifacts')));
    assert.throws(() => validateArtifact({ ...manifest, contents: [] }, join(root, 'artifacts')));
    const candidate = { parentSha, sourceSha, version, tag: `v${version}`, notes };
    save('candidate.json', candidate);
    writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync,copyFileSync,mkdirSync} from 'node:fs';
import {join,basename} from 'node:path';
const args = process.argv.slice(2);
const path = args.join(' ');
if(process.env.TEST_EXPIRED_RUN && path.includes('/runs/42/'))throw new Error('Original gate run expired');
const option = name => args[args.indexOf(name)+1];
const state = existsSync('github.json') ? JSON.parse(readFileSync('github.json')) : null;
const save = value => writeFileSync('github.json',JSON.stringify(value));
const suffixes = ['Linux / Node 24.16.0', 'Linux / Node 26.7.0', 'macOS / Node 26.7.0', 'Required CI gate'];
if (path.includes('/jobs?')) console.log(JSON.stringify([{jobs:suffixes.map(name=>({name:'gate / '+name,conclusion:process.env.TEST_GATE || 'success'}))}]));
else if (path.includes('/attempts/')) console.log(JSON.stringify({repository:{full_name:'rbutera/chaching'},head_repository:{full_name:'rbutera/chaching'},event:'workflow_dispatch',path:'.github/workflows/release.yml',head_sha:process.env.TEST_WORKFLOW_SHA}));
else if (path.includes('/releases?')) console.log(JSON.stringify([state?[state]:[]]));
else if (path.includes('/releases/tags/')) {if(state?.draft)process.exit(1);console.log(JSON.stringify(state));}
else if (args[0]==='release' && args[1]==='create') save({tag_name:args[2],body:readFileSync(option('--notes-file'),'utf8'),draft:true,prerelease:false,assets:[]});
else if (args[0]==='release' && args[1]==='upload') {
 if(process.env.TEST_UPLOAD_FAILURE && !existsSync('upload-retried')) {writeFileSync('upload-retried','1');process.exit(1);}
 mkdirSync('release-assets',{recursive:true});
 for(const file of args.slice(3,args.indexOf('--repo'))) {copyFileSync(file,join('release-assets',basename(file)));if(!state.assets.some(a=>a.name===basename(file)))state.assets.push({name:basename(file)});}
 save(state);
}
else if (args[0]==='release' && args[1]==='download') {
 for(let i=0;i<args.length;i++)if(args[i]==='--pattern')copyFileSync(join('release-assets',args[i+1]),join(option('--dir'),args[i+1]));
}
else if(args[0]==='workflow' && args[1]==='run') writeFileSync('dispatches',String(Number(existsSync('dispatches')?readFileSync('dispatches','utf8'):0)+1));
else if(args[0]==='release' && args[1]==='edit') {
 if(process.env.TEST_FINALIZE_FAILURE)process.exit(1);
 state.draft=false;save(state);
}
else throw new Error('Unexpected GitHub mutation: '+path);
`, { mode: 0o755 });
    writeFileSync(join(bin, 'pnpm'), `#!/usr/bin/env node
import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
assert(process.argv.includes('--ignore-scripts'));assert(process.argv.includes('--provenance'));
if(existsSync('registry.json'))throw new Error('Must not publish same version twice');
const m=JSON.parse(readFileSync('release-assets/manifest.json'));
writeFileSync('registry.json',JSON.stringify({version:m.version,dist:{integrity:m.integrity,tarball:'https://registry.npmjs.org/test.tgz'}}));
`, { mode: 0o755 });
    writeFileSync(join(root, 'registry-preload.mjs'), `
import {existsSync,readFileSync} from 'node:fs';
globalThis.setTimeout=(callback)=>{queueMicrotask(callback);return 0};
let requests=0;
globalThis.fetch=async(url)=>{
 if(url.endsWith('test.tgz'))return new Response(readFileSync('release-assets/${archive}'));
 if(!existsSync('registry.json') || (process.env.TEST_REGISTRY_DELAY && ++requests<3))return new Response('',{status:404});
 const entry=JSON.parse(readFileSync('registry.json'));
 if(process.env.TEST_REGISTRY_MISMATCH)entry.dist.integrity='sha512-wrong';
 return Response.json(entry);
};
`);
    mkdirSync(join(root, '.github/release'));
    save('.github/release/config.json', { npm: '11.19.0' });
    const env = { ...process.env, PATH: `${bin}:${process.env.PATH}`, GITHUB_REPOSITORY: 'rbutera/chaching', GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: parentSha, TEST_WORKFLOW_SHA: parentSha, RELEASE_DRY_RUN: 'true' };
    const promote = extra => {
      save('artifacts/manifest.json', manifest);
      return spawnSync(process.execPath, ['--import', './registry-preload.mjs', script, 'promote'], { cwd: root, encoding: 'utf8', env: { ...env, ...extra } });
    };
    let result = promote();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0], parentSha);
    assert.equal(git('tag', '--list'), '');
    result = promote({ TEST_GATE: 'skipped' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /did not pass/);
    manifest.sourceSha = parentSha;
    assert.notEqual(promote().status, 0, 'Stale source evidence must fail');
    manifest.sourceSha = sourceSha;
    result = promote({ RELEASE_DRY_RUN: 'false', TEST_UPLOAD_FAILURE: 'true' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(git('rev-parse', 'v1.18.1^{}'), sourceSha);
    assert.equal(git('ls-remote', 'origin', 'refs/heads/main').split('\t')[0], sourceSha);
    const original = JSON.parse(readFileSync(join(root, 'artifacts/manifest.json')));
    save('candidate.json', { ...original, recovery: true });
    result = promote({ RELEASE_DRY_RUN: 'false' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(readFileSync(join(root, 'dispatches'), 'utf8'), '2');
    manifest.runId = '43';
    result = promote({ RELEASE_DRY_RUN: 'false', GITHUB_RUN_ID: '43', TEST_EXPIRED_RUN: 'true' });
    assert.equal(result.status, 0, result.stderr);
    manifest.runId = '42';
    const publish = extra => spawnSync(process.execPath, ['--import', './registry-preload.mjs', script, 'publish'], { cwd: root, encoding: 'utf8', env: { ...env, TEST_EXPIRED_RUN: 'true', GITHUB_SHA: sourceSha, GITHUB_REF: 'refs/tags/v1.18.1', RELEASE_RESUME_TAG: 'v1.18.1', ...extra } });
    result = publish({ TEST_FINALIZE_FAILURE: 'true', TEST_REGISTRY_DELAY: 'true' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /gh failed/);
    result = publish();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(JSON.parse(readFileSync(join(root, 'github.json'))).draft, false);
    assert.notEqual(publish({ TEST_REGISTRY_MISMATCH: 'true' }).status, 0);
    rmSync(join(root, 'release-assets', archive));
    assert.notEqual(publish().status, 0, 'Missing artifact cannot publish');
    manifest.runId = '43';
    result = promote({ RELEASE_DRY_RUN: 'false', GITHUB_RUN_ID: '43' });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(publish().status, 0, 'Same-commit rebuild restores missing artifact');
    manifest.integrity = 'sha512-wrong';
    assert.notEqual(promote({ RELEASE_DRY_RUN: 'false' }).status, 0);
    manifest.integrity = original.integrity;
    manifest.runId = '42';
    save('candidate.json', candidate);
    writeFileSync(join(root, 'another-file'), 'concurrent work');
    git('add', 'another-file'); git('commit', '-m', 'concurrent main update');
    git('push', 'origin', 'HEAD:main');
    result = promote({ RELEASE_DRY_RUN: 'false' });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Main advanced/);
    assert.equal(git('tag', '--list'), 'v1.18.1');
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
