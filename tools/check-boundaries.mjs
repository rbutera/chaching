import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createProjectGraphAsync } from 'nx/src/project-graph/project-graph.js';
import { root, directories, layers } from './eslint-boundaries.mjs';
for(const [name,directory] of Object.entries(directories)) {
 const manifest=JSON.parse(readFileSync(join(directory,'package.json'),'utf8'));
 for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) for(const [dependency,version] of Object.entries(manifest[field]??{})) {
  if(dependency.startsWith('@chaching/') && (!layers[name].includes(dependency.slice(10))||version!=='workspace:*')) throw new Error(`Forbidden dependency declaration: ${manifest.name} -> ${dependency}`);
 }
}
await createProjectGraphAsync({exitOnError:true});
function lint(paths) {
 const result=spawnSync(process.execPath,[join(root,'node_modules/eslint/bin/eslint.js'),...paths,'--format','json'],{cwd:root,encoding:'utf8',env:{...process.env,NX_DAEMON:'false'}});
 if(result.error) throw result.error;
 let records;try {records=JSON.parse(result.stdout);}catch{throw new Error(`ESLint did not return diagnostics: ${result.stdout}\n${result.stderr}`);}
 return {status:result.status,messages:records.flatMap(r=>r.messages)};
}
const fixtures=[
 ['shared','boundary-control.ts',"import '@chaching/core/engine';\n",'@nx/enforce-module-boundaries'],
 ['web','boundary-control.ts',"import '@chaching/cli/commands/sync';\n",'@nx/enforce-module-boundaries'],
 ['web','boundary-control.svelte',"<script>import '@chaching/receipt/receipt/render-png';</script>\n",'boundaries/imports'],
 ['web','boundary-control.ts',"import '@chaching/shared/format';\n",null]
];
for(const [name,filename,text,expected] of fixtures) {
 const directory=join(directories[name],'src');mkdirSync(directory,{recursive:true});const path=join(directory,filename);
 let created = false;
 try {
  writeFileSync(path,text,{flag:'wx'});
  created = true;
  const result=lint([path]);
  if(expected ? result.status===0||!result.messages.some(message=>message.ruleId===expected && !message.fatal) : result.status!==0) throw new Error(`Boundary control failed (${name}/${filename}): ${JSON.stringify(result)}`);
 } finally {if (created) rmSync(path,{force:true});}
}
const transitive = [
 [join(directories.web, 'src/boundary-control-leaf.ts'), "import 'node:fs';\n"],
 [join(directories.web, 'src/boundary-control-wrapper.ts'), "import './boundary-control-leaf.js';\n"],
 [join(directories.web, 'src/boundary-control-entry.ts'), "import './boundary-control-wrapper.js';\n"]
];
const createdPaths = [];
try {
 for (const [path, text] of transitive) {
  writeFileSync(path, text, { flag: 'wx' });
  createdPaths.push(path);
 }
 const result = lint([transitive[2][0]]);
 if (result.status === 0 || !result.messages.some(message => message.ruleId === 'boundaries/imports' && message.message.includes('node:fs'))) throw new Error(`Transitive JavaScript specifier control failed: ${JSON.stringify(result)}`);
} finally { for (const path of createdPaths) rmSync(path, { force: true }); }
const result=lint(['packages','apps']);
if(result.status!==0) {for(const message of result.messages)console.error(`${message.ruleId}: ${message.message}`);process.exit(1);}
console.log('Dependency declarations, forbidden controls and browser import graphs passed.');
