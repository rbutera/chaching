import { existsSync, readFileSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isBuiltin } from 'node:module';
import ts from 'typescript';
export const root = fileURLToPath(new URL('../', import.meta.url));
export const layers = { shared: [], core: ['shared'], receipt: ['shared'], cli: ['shared','core','receipt'], web: ['shared','core','receipt'], site: ['shared','receipt'] };
export const directories = Object.fromEntries(Object.keys(layers).map(name => [name, join(root, ['web','site'].includes(name) ? 'apps' : 'packages', name)]));
const manifests = Object.fromEntries(Object.entries(directories).map(([name,path]) => [name, JSON.parse(readFileSync(join(path,'package.json'),'utf8'))]));
function owner(path) { return Object.entries(directories).find(([,dir]) => path.startsWith(dir + '/'))?.[0]; }
function test(path) { return /(?:\.(test|spec)\.[^.]+$|\/test-setup\.ts$)/.test(path); }
function server(path) { return /(?:\/server\/|\.server\.[^.]+$|\/\+server\.[^.]+$|\/scripts\/)/.test(path); }
function file(path) { const source = path.replace(/\.(?:m?js|jsx)$/, ''); return [path,...(source !== path ? ['.ts','.tsx','.mts'].map(ext=>source+ext) : []),...['.ts','.tsx','.js','.mjs','.svelte','/index.ts','/index.js'].map(ext=>path+ext)].find(p=>existsSync(p) && extname(p)); }
function target(specifier, from) {
 if(specifier.startsWith('.')) return file(resolve(dirname(from),specifier));
 if(specifier.startsWith('$lib/')) return file(join(directories.web,'src/lib',specifier.slice(5)));
 const match=specifier.match(/^@chaching\/([^/]+)(.*)$/);
 if(!match) return;
 const manifest=manifests[match[1]];
 const subpath=manifest?.exports?.[match[2] ? '.'+match[2] : '.'];
 if(typeof subpath==='string') return file(join(directories[match[1]],subpath));
}
function imports(path) {
 let text=readFileSync(path,'utf8');
 if(path.endsWith('.svelte')) text=[...text.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]).join('\n');
 const ast=ts.createSourceFile(path,text,ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
 const result=[];
 function visit(node) {
  if((ts.isImportDeclaration(node)||ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier) && !node.importClause?.isTypeOnly && !node.isTypeOnly) result.push(node.moduleSpecifier.text);
  if(ts.isCallExpression(node) && node.expression.kind===ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) result.push(node.arguments[0].text);
  ts.forEachChild(node,visit);
 }
 visit(ast); return result;
}
function unsafe(specifier,from,seen=new Set()) {
 if(isBuiltin(specifier) || /^(?:pg|satori|@resvg\/resvg-js)(?:\/|$)/.test(specifier) || /^\$env\/(?:static|dynamic)\/private$/.test(specifier)) return specifier;
 const path=target(specifier,from);
 if(!path || seen.has(path) || !/\.(?:ts|tsx|js|mjs|svelte)$/.test(path)) return;
 if(server(path) || owner(path)==='core' || owner(path)==='cli') return relative(root,path);
 seen.add(path);
 for(const next of imports(path)) {const hit=unsafe(next,path,seen);if(hit) return `${specifier} -> ${hit}`;}
}
const rule = {
 meta:{type:'problem',schema:[],messages:{declaration:'Undeclared dependency {{name}} in {{owner}}.',relative:'Cross-package relative import {{name}}.',browser:'Browser import reaches server code: {{name}}.',shared:'Shared runtime cannot import {{name}}.',site:'Site receipt imports belong in build scripts: {{name}}.'}},
 create(context) {
  const path=resolve(context.filename); const layer=owner(path);
  if(!layer) return {};
  const manifest=manifests[layer];
  const browser=(layer==='web'||layer==='site')&&path.includes('/src/')&&!server(path)&&!test(path);
  function check(node,value) {
   if(typeof value!=='string') return;
   if(value.startsWith('.')) {const to=target(value,path); if(to&&owner(to)&&owner(to)!==layer) context.report({node,messageId:'relative',data:{name:value}});}
   else if(!value.startsWith('$')&&!value.startsWith('/')&&!isBuiltin(value)) {
    const name=value.startsWith('@')?value.split('/').slice(0,2).join('/'):value.split('/')[0];
    const development = test(path) || !path.includes('/src/') || node.importKind === 'type' || node.exportKind === 'type';
    const fields = development ? ['dependencies','devDependencies','optionalDependencies','peerDependencies'] : ['dependencies','optionalDependencies','peerDependencies'];
    if(name!==manifest.name && !fields.some(field=>manifest[field]?.[name])) context.report({node,messageId:'declaration',data:{name,owner:layer}});
   }
   if(layer==='shared'&&path.includes('/src/')&&!test(path)&&(isBuiltin(value)||value.startsWith('$'))) context.report({node,messageId:'shared',data:{name:value}});
   if(layer==='site'&&!server(path)&&!test(path)&&value.startsWith('@chaching/receipt')) context.report({node,messageId:'site',data:{name:value}});
   if(browser && node.importKind!=='type' && node.exportKind!=='type') {const hit=unsafe(value,path);if(hit)context.report({node,messageId:'browser',data:{name:hit}});}
  }
  return {ImportDeclaration:n=>check(n,n.source.value),ExportNamedDeclaration:n=>n.source&&check(n,n.source.value),ExportAllDeclaration:n=>check(n,n.source.value),ImportExpression:n=>check(n,n.source.value)};
 }
};
export default {rules:{imports:rule}};
