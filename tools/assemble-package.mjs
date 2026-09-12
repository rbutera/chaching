import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { isBuiltin } from 'node:module';
import ts from 'typescript';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = join(root, 'dist/chaching');
const metadata = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const path of ['packages/cli/dist/index.js', 'apps/web/build/index.js']) {
 if (!existsSync(join(root, path))) throw new Error(`Missing build output: ${path}`);
}
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const [source, target] of [
 ['packages/cli/dist', 'cli'], ['apps/web/build', 'server'], ['bin', 'bin'],
 ['packages/shared/src/pricing/data', 'assets/pricing'], ['packages/receipt/assets/fonts', 'assets/fonts'],
 ...['docs', 'CONFIG.md', 'config.example.json', 'docker-compose.sync.yml', 'LICENSE', 'README.md'].map(path => [path, path])
]) cpSync(join(root, source), join(output, target), { recursive: true });
const serverEntry = join(output, 'server/index.js');
writeFileSync(serverEntry, `import { fileURLToPath as chachingPackageUrl } from 'node:url';\nprocess.env.CHACHING_PACKAGE_ROOT ??= chachingPackageUrl(new URL('../', import.meta.url));\n${readFileSync(serverEntry, 'utf8')}`);
const declared = {};
const optional = {};
for (const directory of ['packages/shared','packages/core','packages/receipt','packages/cli','apps/web']) {
 const manifest = JSON.parse(readFileSync(join(root, directory, 'package.json'), 'utf8'));
 Object.assign(declared, manifest.dependencies, manifest.devDependencies, manifest.optionalDependencies);
 Object.assign(optional, manifest.optionalDependencies);
}
const dependencies = {};
const optionalDependencies = {};
function inspect(directory) {
 for (const entry of readdirSync(directory, { withFileTypes: true })) {
  const path = join(directory, entry.name);
  if (entry.isDirectory()) inspect(path);
  else if (entry.name.endsWith('.js') || entry.name.endsWith('.mjs')) {
   const text = readFileSync(path, 'utf8');
   const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
   function visit(node) {
    let name;
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) name = node.moduleSpecifier.text;
    if (ts.isCallExpression(node) && node.arguments.length && ts.isStringLiteral(node.arguments[0]) && (node.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(node.expression) && ['require','__require'].includes(node.expression.text)))) name = node.arguments[0].text;
    if (name && !name.startsWith('.') && !name.startsWith('/') && !isBuiltin(name)) {
     if (name.startsWith('@chaching/') || name === 'sqlite') throw new Error(`Unbundled workspace or SQLite import ${name} in ${path}`);
     const pkg = name.startsWith('@') ? name.split('/').slice(0,2).join('/') : name.split('/')[0];
     if (!declared[pkg] || declared[pkg].startsWith('workspace:')) throw new Error(`Undeclared emitted dependency ${pkg} in ${path}`);
     (optional[pkg] ? optionalDependencies : dependencies)[pkg] = declared[pkg];
    }
    ts.forEachChild(node, visit);
   }
   visit(source);
  }
 }
}
inspect(join(output,'cli'));
inspect(join(output,'server'));
const manifest = Object.fromEntries(Object.entries(metadata).filter(([key]) => !['private','packageManager','scripts','devDependencies','dependencies','optionalDependencies','nx'].includes(key)));
Object.assign(manifest, { name:'chaching', bin:{chaching:'bin/chaching.js'}, files:['bin','cli','server','assets','docs','CONFIG.md','config.example.json','docker-compose.sync.yml','LICENSE','README.md'], dependencies, optionalDependencies, publishConfig:{access:'public'} });
writeFileSync(join(output,'package.json'), JSON.stringify(manifest,null,'\t')+'\n');
console.log(`Assembled ${output}`);
