import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const marker = 'chaching-release-v1\n';
const repo = process.env.GITHUB_REPOSITORY || 'rbutera/chaching';
const json = path => JSON.parse(readFileSync(path, 'utf8'));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + '\n');
export function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} failed (${result.status}): ${result.stderr || result.stdout}`);
  return result.stdout?.trim() || '';
}
const git = (...args) => run('git', args);
const gh = (...args) => run('gh', args);
const api = (path, ...args) => JSON.parse(gh('api', `repos/${repo}/${path}`, ...args));
const sha = ref => git('rev-parse', `${ref}^{commit}`);
export const integrity = bytes => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
export function bump(version, level) {
  assert.match(version, /^\d+\.\d+\.\d+$/);
  assert(['patch', 'minor', 'major'].includes(level), 'Unknown version bump');
  const parts = version.split('.').map(Number);
  const index = { major: 0, minor: 1, patch: 2 }[level];
  parts[index]++;
  return parts.map((value, i) => i > index ? 0 : value).join('.');
}
export function packageContents(archive) {
  const paths = run('tar', ['-tzf', archive]).split('\n');
  for (const path of paths) assert(path.startsWith('package/') && !path.split('/').includes('..'), `Unsafe archive path: ${path}`);
  const temp = mkdtempSync(join(tmpdir(), 'chaching-contents-'));
  try {
    run('tar', ['-xzf', resolve(archive), '-C', temp]);
    return paths.filter(path => !path.endsWith('/')).sort().map(path => {
      const file = join(temp, path);
      const stat = lstatSync(file);
      assert(stat.isFile(), `Expected a regular package file: ${path}`);
      return { path, mode: stat.mode & 0o777, integrity: integrity(readFileSync(file)) };
    });
  } finally { rmSync(temp, { recursive: true, force: true }); }
}
export function validateArtifact(manifest, directory) {
  assert.match(manifest.archive, /^chaching-\d+\.\d+\.\d+\.tgz$/);
  assert.equal(manifest.name, 'chaching');
  assert.equal(manifest.archive, `chaching-${manifest.version}.tgz`);
  const archive = join(directory, manifest.archive);
  assert.equal(integrity(readFileSync(archive)), manifest.integrity, 'Tarball integrity mismatch');
  assert.deepEqual(packageContents(archive), manifest.contents, 'Package contents mismatch');
  const pkg = JSON.parse(run('tar', ['-xOf', archive, 'package/package.json']));
  assert.equal(pkg.version, manifest.version);
  assert.equal(pkg.name, 'chaching');
  assert.equal(pkg.repository.url, 'git+https://github.com/rbutera/chaching.git');
  assert(!pkg.scripts, 'Published package must not run lifecycle scripts');
  return archive;
}
function output(values) {
  for (const [key, value] of Object.entries(values)) {
    console.log(`${key}=${value}`);
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
  }
}
function annotated(tag) {
  assert.match(tag, /^v\d+\.\d+\.\d+$/);
  assert.equal(git('cat-file', '-t', `refs/tags/${tag}`), 'tag', 'Automated release requires an annotated tag');
  const message = git('for-each-ref', '--format=%(contents)', `refs/tags/${tag}`);
  assert(message.startsWith(marker), 'Tag has no automated release evidence');
  const manifest = JSON.parse(message.slice(marker.length));
  assert.equal(manifest.tag, tag);
  assert.equal(manifest.version, tag.slice(1));
  assert.equal(manifest.sourceSha, sha(tag), 'Tag target changed');
  assert.equal(manifest.tagObject, undefined, 'Tag object cannot refer to itself');
  git('merge-base', '--is-ancestor', manifest.sourceSha, 'origin/main');
  assert.equal(git('rev-parse', `${manifest.sourceSha}^`), manifest.parentSha);
  assert.equal(JSON.parse(git('show', `${manifest.sourceSha}:package.json`)).version, manifest.version);
  assert.deepEqual(git('diff-tree', '--no-commit-id', '--name-only', '-r', manifest.sourceSha).split('\n').sort(), ['CHANGELOG.md', 'package.json']);
  const before = JSON.parse(git('show', `${manifest.parentSha}:package.json`));
  const after = JSON.parse(git('show', `${manifest.sourceSha}:package.json`));
  before.version = after.version;
  assert.deepEqual(before, after, 'Release commit changed package metadata beyond version');
  assert(git('show', `${manifest.sourceSha}:CHANGELOG.md`).startsWith(manifest.notes + '\n'));
  return manifest;
}
async function registry(version) {
  const response = await fetch(`https://registry.npmjs.org/chaching/${version}`, { signal: AbortSignal.timeout(30_000) });
  if (response.status === 404) return null;
  assert(response.ok, `Registry returned ${response.status}`);
  return response.json();
}
async function pollRegistry(manifest, timeout = 180_000) {
  const until = Date.now() + timeout;
  do {
    const published = await registry(manifest.version);
    if (published) {
      assert.equal(published.version, manifest.version);
      assert.equal(published.dist.integrity, manifest.integrity, 'Published npm integrity mismatch');
      const response = await fetch(published.dist.tarball, { signal: AbortSignal.timeout(30_000) });
      assert(response.ok, 'Cannot download registry tarball');
      assert.equal(integrity(Buffer.from(await response.arrayBuffer())), manifest.integrity);
      return published;
    }
    if (Date.now() >= until) break;
    await new Promise(done => setTimeout(done, 5000));
  } while (true);
  throw new Error(`npm version ${manifest.version} did not appear`);
}
async function retry(operation) {
  for (let attempt = 0; ; attempt++) {
    try { return await operation(); }
    catch (error) {
      if (attempt === 3) throw error;
      await new Promise(done => setTimeout(done, 2000 * (attempt + 1)));
    }
  }
}
function releases() { return JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/releases?per_page=100`)).flat(); }
function download(manifest, directory) {
  mkdirSync(directory, { recursive: true });
  gh('release', 'download', manifest.tag, '--repo', repo, '--dir', directory, '--pattern', manifest.archive, '--pattern', 'manifest.json', '--pattern', 'gate.json', '--clobber');
  assert.deepEqual(json(join(directory, 'manifest.json')), manifest, 'Release manifest differs from immutable tag evidence');
  validateArtifact(manifest, directory);
  const evidence = json(join(directory, 'gate.json'));
  assert.equal(evidence.sourceSha, manifest.sourceSha);
  assert.equal(evidence.integrity, manifest.integrity);
  assert.equal(evidence.gateWorkflowBlob, git('rev-parse', `${evidence.workflowSha}:.github/workflows/ci.yml`));
  git('merge-base', '--is-ancestor', evidence.workflowSha, 'origin/main');
  return evidence;
}
export function validateGateJobs(jobs) {
  for (const suffix of ['Linux / Node 24.16.0', 'Linux / Node 26.7.0', 'macOS / Node 26.7.0', 'Required CI gate']) {
    const matches = jobs.filter(job => job.name === suffix || job.name.endsWith(` / ${suffix}`));
    assert.equal(matches.length, 1, `Missing or ambiguous gate job ${suffix}`);
    assert.equal(matches[0].conclusion, 'success', `${suffix} did not pass`);
  }
}
function gateEvidence(runId, attempt) {
  assert.match(String(runId), /^\d+$/);
  assert.match(String(attempt), /^\d+$/);
  const record = api(`actions/runs/${runId}/attempts/${attempt}`);
  assert.equal(record.repository.full_name, repo);
  assert(['workflow_dispatch', 'schedule'].includes(record.event), 'Untrusted gate trigger');
  assert.equal(record.path, '.github/workflows/release.yml');
  assert.equal(record.head_repository.full_name, repo);
  const jobs = JSON.parse(gh('api', '--paginate', '--slurp', `repos/${repo}/actions/runs/${runId}/attempts/${attempt}/jobs?per_page=100`)).flatMap(page => page.jobs);
  validateGateJobs(jobs);
  return record;
}
async function verify(manifest, { draft = false, poll = false } = {}) {
  const live = annotated(manifest.tag);
  assert.deepEqual(live, manifest);
  const release = draft ? releases().find(release => release.tag_name === manifest.tag) : api(`releases/tags/${manifest.tag}`);
  assert(release, `GitHub release ${manifest.tag} is missing`);
  assert.equal(release.prerelease, false);
  if (!draft) assert.equal(release.draft, false, 'GitHub release is still a draft');
  assert.equal(release.body, manifest.notes);
  const temp = mkdtempSync(join(tmpdir(), 'chaching-release-verify-'));
  try { download(manifest, temp); } finally { rmSync(temp, { recursive: true, force: true }); }
  if (!draft) await pollRegistry(manifest, poll ? 180_000 : 0);
  return release;
}
async function prepare() {
  assert.equal(process.env.GITHUB_REF, 'refs/heads/main', 'Preparation must run from main');
  git('fetch', 'origin', 'main', '--tags');
  const source = sha('origin/main');
  assert.equal(sha('HEAD'), source, 'Main advanced before preparation; rerun on current main');
  const config = json('.github/release/config.json');
  assert.equal(sha(config.bootstrap.tag), config.bootstrap.sha);
  git('merge-base', '--is-ancestor', config.bootstrap.sha, source);
  const history = releases();
  const bootstrap = history.find(release => release.tag_name === config.bootstrap.tag);
  assert(bootstrap && !bootstrap.draft && !bootstrap.prerelease, 'Bootstrap GitHub release missing');
  const published = await registry(config.bootstrap.tag.slice(1));
  assert.equal(published?.gitHead, config.bootstrap.sha);
  assert.equal(published?.dist.integrity, config.bootstrap.integrity);
  let baseline = config.bootstrap.sha;
  const candidates = git('tag', '--list', 'v*').split('\n').filter(Boolean).filter(tag => git('for-each-ref', '--format=%(contents)', `refs/tags/${tag}`).startsWith(marker)).map(annotated);
  candidates.sort((a, b) => a.version.localeCompare(b.version, undefined, { numeric: true }));
  for (const manifest of candidates) {
    const release = history.find(release => release.tag_name === manifest.tag);
    if (!release || release.draft || ![manifest.archive, 'manifest.json', 'gate.json'].every(name => release.assets.some(asset => asset.name === name))) {
      save('candidate.json', { ...manifest, recovery: true });
      output({ mode: 'recover', ref: manifest.sourceSha, tag: manifest.tag });
      return;
    }
    await verify(manifest);
    baseline = manifest.sourceSha;
  }
  const { releaseInputs, releaseNotes } = await import('./release-inputs.mjs');
  const changes = releaseInputs(baseline, source);
  console.log(JSON.stringify(changes, null, 2));
  if (process.env.RELEASE_SCHEDULED === 'true' && !changes.eligible) {
    output({ mode: 'noop' });
    return;
  }
  const metadata = json('package.json');
  const version = bump(metadata.version, process.env.RELEASE_BUMP || 'patch');
  const tag = `v${version}`;
  assert(!git('tag', '--list', tag), `Version tag ${tag} already exists without recoverable evidence`);
  assert.equal(await registry(version), null, `npm ${version} already exists without recoverable evidence`);
  const notes = `## ${version} (${new Date().toISOString().slice(0, 10)})\n\n${releaseNotes(baseline, source)}`.trimEnd();
  metadata.version = version;
  writeFileSync('package.json', JSON.stringify(metadata, null, '\t') + '\n');
  writeFileSync('CHANGELOG.md', notes + '\n\n' + (existsSync('CHANGELOG.md') ? readFileSync('CHANGELOG.md', 'utf8') : ''));
  git('config', 'user.name', 'github-actions[bot]');
  git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
  git('add', 'package.json', 'CHANGELOG.md');
  git('commit', '-m', `chore(release): ${version}`);
  const releaseSha = sha('HEAD');
  const branch = `release-candidate/${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}`;
  git('push', 'origin', `HEAD:refs/heads/${branch}`);
  save('candidate.json', { parentSha: source, sourceSha: releaseSha, version, tag, notes, baseline, branch });
  output({ mode: 'prepare', ref: releaseSha, tag });
}
async function promote() {
  git('fetch', 'origin', 'main', '--tags');
  const candidate = json('candidate.json');
  const tested = json('artifacts/manifest.json');
  validateArtifact(tested, 'artifacts');
  assert.equal(tested.sourceSha, candidate.sourceSha);
  assert.equal(tested.version, candidate.version);
  assert.equal(tested.platform, 'linux');
  assert.equal(tested.node, 'v26.7.0');
  assert.equal(String(tested.runId), process.env.GITHUB_RUN_ID);
  const record = gateEvidence(process.env.GITHUB_RUN_ID, process.env.GITHUB_RUN_ATTEMPT);
  assert.equal(record.head_sha, process.env.GITHUB_SHA);
  let manifest;
  if (candidate.recovery) {
    manifest = annotated(candidate.tag);
    assert.equal(tested.integrity, manifest.integrity, 'Rebuilt release differs; preserve original release for repair');
    assert.deepEqual(tested.contents, manifest.contents);
  } else {
    manifest = { ...tested, ...candidate, gateRunId: process.env.GITHUB_RUN_ID, gateAttempt: process.env.GITHUB_RUN_ATTEMPT, workflowSha: process.env.GITHUB_SHA, gateWorkflowBlob: git('rev-parse', `${candidate.sourceSha}:.github/workflows/ci.yml`) };
  }
  save('artifacts/manifest.json', manifest);
  save('artifacts/gate.json', { sourceSha: manifest.sourceSha, integrity: manifest.integrity, gateWorkflowBlob: git('rev-parse', `${record.head_sha}:.github/workflows/ci.yml`), runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT, workflowSha: record.head_sha });
  if (process.env.RELEASE_DRY_RUN === 'true') {
    console.log('Dry run passed: exact candidate and package passed every gate. No release refs or registry changes.');
    return;
  }
  if (!candidate.recovery) {
    assert.equal(sha('origin/main'), candidate.parentSha, 'Main advanced; candidate retained. Rerun preparation on new main.');
    git('config', 'user.name', 'github-actions[bot]');
    git('config', 'user.email', '41898282+github-actions[bot]@users.noreply.github.com');
    writeFileSync('tag-message.txt', marker + JSON.stringify(manifest));
    git('tag', '-a', candidate.tag, candidate.sourceSha, '-F', 'tag-message.txt');
    git('push', '--atomic', 'origin', `${candidate.sourceSha}:refs/heads/main`, `refs/tags/${candidate.tag}`);
    git('fetch', 'origin', 'main');
  }
  const existing = releases().find(release => release.tag_name === candidate.tag);
  if (!existing) {
    writeFileSync('release-notes.md', manifest.notes);
    await retry(() => gh('release', 'create', manifest.tag, '--repo', repo, '--verify-tag', '--draft', '--title', `chaching ${manifest.tag}`, '--notes-file', 'release-notes.md'));
  } else assert.equal(existing.body, manifest.notes);
  await retry(() => gh('release', 'upload', manifest.tag, `artifacts/${manifest.archive}`, 'artifacts/manifest.json', 'artifacts/gate.json', '--repo', repo, '--clobber'));
  await verify(manifest, { draft: true });
  gh('workflow', 'run', 'release.yml', '--repo', repo, '--ref', manifest.tag, '-f', `resume_tag=${manifest.tag}`, '-f', 'dry_run=false');
  console.log(`Dispatched tagged publication of ${manifest.tag}; completion is verified by that run.`);
}
async function publish() {
  const tag = process.env.RELEASE_RESUME_TAG;
  assert.equal(process.env.GITHUB_REF, `refs/tags/${tag}`, 'Publish must execute at the release tag');
  git('fetch', 'origin', 'main', '--tags');
  const manifest = annotated(tag);
  assert.equal(sha('HEAD'), manifest.sourceSha);
  assert.equal(process.env.GITHUB_SHA, manifest.sourceSha);
  assert.equal(git('rev-parse', `${manifest.sourceSha}:.github/workflows/ci.yml`), manifest.gateWorkflowBlob);
  const evidence = download(manifest, 'artifacts');
  const record = gateEvidence(evidence.runId, evidence.attempt);
  assert.equal(record.head_sha, evidence.workflowSha);
  const published = await registry(manifest.version);
  if (published) assert.equal(published.dist.integrity, manifest.integrity, 'Existing npm version has different bytes');
  else run('pnpm', ['--package', `npm@${json('.github/release/config.json').npm}`, 'dlx', 'npm', 'publish', resolve('artifacts', manifest.archive), '--ignore-scripts', '--provenance', '--access', 'public'], { stdio: 'inherit' });
  await pollRegistry(manifest);
  gh('release', 'edit', tag, '--repo', repo, '--draft=false', '--latest');
  await verify(manifest, { poll: true });
}
async function main() {
  const command = process.argv[2];
  if (command === 'prepare') await prepare();
  else if (command === 'promote') await promote();
  else if (command === 'publish') await publish();
  else if (command === 'verify') {
    git('fetch', 'origin', 'main', '--tags');
    await verify(annotated(process.env.RELEASE_RESUME_TAG), { poll: true });
    console.log('Release complete: tag, npm bytes and published GitHub assets agree.');
  } else throw new Error('Usage: node tools/release.mjs prepare|promote|publish|verify');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
