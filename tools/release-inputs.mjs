import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { posix } from 'node:path';

const require = createRequire(import.meta.url);
const { parse } = createRequire(require.resolve('nx/package.json'))('yaml');
const dependencyKey = (name, version) => version.replace(/\(.*$/, '').includes('@') ? version : `${name}@${version}`;
const buildDependency = name => /^(?:@fontsource\/|@sveltejs\/|svelte$|vite$|tsup$|tsx$|typescript$|nx$|sharp$|satori$|@resvg\/|culori$)/.test(name);
const excluded = path => /(^|\/)(?:docs|planning|tests?|__tests__|__fixtures__|fixtures|coverage|node_modules|dist|build|\.svelte-kit)(\/|$)/.test(path) || /\.(?:test|spec)\.[^/]+$/.test(path) || /(?:^|\/)(?:README[^/]*|CHANGELOG[^/]*|AGENTS\.md|vitest\.config\.[^/]+|(?:[^/]*-)?test-(?:setup|harness|helpers|utils)\.[^/]+)$/.test(path) || path.endsWith('.md');
const buildTarget = name => /^(?:build(?::|$)|package$|assets$|sync$|gen:|prebuild$|prepack$|prepare$)/.test(name);
const pick = (object, predicate) => Object.fromEntries(Object.entries(object ?? {}).filter(([key]) => predicate(key)));
const stable = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
function git(cwd, ...args) {
 return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
}
function snapshot(ref, cwd) {
 const blobs = new Map(git(cwd, 'ls-tree', '-r', '-z', ref).split('\0').filter(Boolean).map(entry => {
  const tab = entry.indexOf('\t');
  return [entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]];
 }));
 const files = new Set(blobs.keys());
 const read = path => files.has(path) ? git(cwd, 'show', `${ref}:${path}`) : '';
 const json = path => files.has(path) ? JSON.parse(read(path)) : {};
 const manifests = new Map([...files].filter(path => /^(?:package.json|(?:apps|packages)\/[^/]+\/package.json)$/.test(path)).map(path => [posix.dirname(path), json(path)]));
 const projects = new Map([...files].filter(path => /^(?:project.json|(?:apps|packages)\/[^/]+\/project.json)$/.test(path)).map(path => [posix.dirname(path), json(path)]));
 const byName = new Map([...manifests].map(([root, manifest]) => [manifest.name, root]));
 for (const [root, project] of projects) byName.set(project.name, root);
 const roots = new Set(['.']);
 const queue = ['packages/cli', 'apps/web', ...['distribution', 'cli', 'web'].map(name => byName.get(name)).filter(Boolean)];
 while (queue.length) {
  const root = queue.pop();
  if (roots.has(root) && root !== '.') continue;
  roots.add(root);
  const manifest = manifests.get(root) ?? {};
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies };
  for (const name of [...Object.keys(dependencies), ...(projects.get(root)?.implicitDependencies ?? [])]) {
   const dependency = byName.get(name);
   if (dependency && !roots.has(dependency)) queue.push(dependency);
  }
 }
 const lock = parse(read('pnpm-lock.yaml')) ?? {};
 const external = {};
 const pending = [];
 for (const root of roots) {
  const importer = lock.importers?.[root] ?? {};
  for (const category of ['dependencies', 'optionalDependencies', 'devDependencies']) {
   for (const [name, value] of Object.entries(importer[category] ?? {})) {
    if (category === 'devDependencies' && !buildDependency(name)) continue;
    const version = typeof value === 'object' ? value.version : value;
    if (/^(?:link:|workspace:)/.test(version)) continue;
    external[`${root}:${category}:${name}`] = value;
    pending.push(dependencyKey(name, version));
   }
  }
 }
 const visited = new Set();
 while (pending.length) {
  const key = pending.pop();
  if (visited.has(key)) continue;
  visited.add(key);
  const node = lock.snapshots?.[key];
  const packageKey = key.replace(/\(.*$/, '');
  external[key] = { snapshot: node, package: lock.packages?.[packageKey] };
  for (const [name, version] of Object.entries({ ...node?.dependencies, ...node?.optionalDependencies })) {
   pending.push(dependencyKey(name, version));
  }
 }
 function relevant(path) {
  if (excluded(path) || path.startsWith('apps/site/') || path.startsWith('.github/')) return false;
  if (['package.json', 'project.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'nx.json', '.npmrc', '.nvmrc', 'tsconfig.json', 'tsconfig.base.json', 'vite.config.ts', 'svelte.config.js', 'tsup.config.ts', 'config.example.json', 'docker-compose.sync.yml'].includes(path)) return true;
  if (/^(?:bin|src|cli|static|scripts)\//.test(path)) return true;
  if (['tools/assemble-package.mjs', 'tools/copy-web-assets.mjs', 'tools/check-font-assets.mjs'].includes(path)) return true;
  return [...roots].some(root => root !== '.' && path.startsWith(`${root}/`));
 }
 function value(path) {
  if (path === 'pnpm-lock.yaml') return stable({ settings: lock.settings, external });
  if (path.endsWith('package.json')) {
   const manifest = json(path);
   const { version, scripts, devDependencies, nx, ...rest } = manifest;
   return stable({ ...rest, scripts: pick(scripts, buildTarget), devDependencies: pick(devDependencies, buildDependency) });
  }
  if (path.endsWith('project.json')) {
   const { targets, tags, ...rest } = json(path);
   return stable({ ...rest, targets: pick(targets, buildTarget) });
  }
  if (path === 'nx.json') {
   const { targetDefaults, ...rest } = json(path);
   return stable({ ...rest, targetDefaults: pick(targetDefaults, buildTarget) });
  }
  return blobs.get(path);
 }
 return { relevant, value };
}

export function releaseInputs(base, head, cwd = process.cwd()) {
 const before = snapshot(base, cwd);
 const after = snapshot(head, cwd);
 const changed = git(cwd, 'diff', '--no-renames', '--name-only', '-z', base, head, '--').split('\0').filter(Boolean);
 const paths = changed.filter(path => (before.relevant(path) || after.relevant(path)) && before.value(path) !== after.value(path));
 return { eligible: paths.length > 0, paths };
}

export function releaseNotes(base, head, cwd = process.cwd()) {
 const groups = { Features: [], Fixes: [], 'Other changes': [] };
 const commits = git(cwd, 'rev-list', '--reverse', '--no-merges', `${base}..${head}`).trim().split('\n').filter(Boolean);
 for (const commit of commits) {
  const subject = git(cwd, 'show', '-s', '--format=%s', commit).trim();
  if (/^chore(?:\(release\))?:\s*(?:release\s+|v?\d+\.\d+\.\d+)/i.test(subject)) continue;
  if (!releaseInputs(`${commit}^`, commit, cwd).eligible) continue;
  const conventional = /^(feat|fix)(?:\([^)]*\))?!?:\s*(.*)$/.exec(subject);
  const group = conventional?.[1] === 'feat' ? 'Features' : conventional?.[1] === 'fix' ? 'Fixes' : 'Other changes';
  const title = (conventional?.[2] ?? subject).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/([\\`*_{}\[\]()#!|])/g, '\\$1');
  groups[group].push(`- ${title} (${commit.slice(0, 7)})`);
 }
 return Object.entries(groups).filter(([, entries]) => entries.length).map(([name, entries]) => `### ${name}\n\n${entries.join('\n')}`).join('\n\n') || 'No app changes since the previous release.';
}
