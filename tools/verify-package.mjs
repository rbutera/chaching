import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, readFile, writeFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';

const exec = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
const temp = await mkdtemp(join(tmpdir(), 'chaching-package-'));
const packageInput = process.argv[2] || process.env.CHACHING_PACKAGE_TARBALL;
const base = (process.env.CHACHING_BASE_PATH || '').replace(/\/$/, '');
let server;
let serverExit;
let serverOutput = '';
const configHome = join(temp, 'config');
const dataHome = join(temp, 'data');
const providerRoot = join(temp, 'claude');
const env = {
	...process.env,
	XDG_CONFIG_HOME: configHome,
	XDG_DATA_HOME: dataHome,
	CLAUDE_CONFIG_DIR: providerRoot,
	CHACHING_DATABASE_URL: '',
	CHACHING_NO_OPEN: '1',
	CHACHING_NO_ART: '1',
	NO_COLOR: '1',
	CHACHING_PACKAGE_ROOT: '',
	CHACHING_ASSET_ROOT: ''
};
async function command(program, args, cwd = temp, extraEnv = {}) {
	try {
		return await exec(program, args, {cwd, env:{...env,...extraEnv}, timeout:180_000, maxBuffer:32*1024*1024});
	} catch (error) {
		throw new Error(`${program} ${args.join(' ')} failed\n${error.stdout || ''}\n${error.stderr || error.message}`, {cause:error});
	}
}
async function stopServer() {
	if (!server) return;
	server.kill('SIGTERM');
	let timer;
	await Promise.race([serverExit, new Promise(done => {timer=setTimeout(done,3000);})]);
	clearTimeout(timer);
	if (server.exitCode === null && server.signalCode === null) {
		server.kill('SIGKILL');
		await serverExit;
	}
	server = null;
}
async function unusedPort() {
	const listener = createServer();
	await new Promise((done, reject) => listener.once('error',reject).listen(0,'127.0.0.1',done));
	const address = listener.address();
	const port = address.port;
	await new Promise(done=>listener.close(done));
	return port;
}
async function png(path) {
	const bytes = await readFile(path);
	assert(bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])), `${path} must be a PNG`);
	assert(bytes.length > 1000, `${path} must contain rendered content`);
}
async function waitFor(url) {
	const deadline = Date.now()+30000;
	while (Date.now()<deadline) {
		if (server.exitCode !== null) throw new Error(`Dashboard exited: ${serverOutput}`);
		try { const response=await fetch(url,{signal:AbortSignal.timeout(1000)}); if(response.ok)return response; } catch {}
		await new Promise(done=>setTimeout(done,100));
	}
	throw new Error(`Dashboard not ready: ${serverOutput}`);
}
try {
	let tarball;
	if (packageInput) tarball=resolve(packageInput);
	else {
		const packed=JSON.parse((await command('npm',['pack',join(root,'dist/chaching'),'--ignore-scripts','--json','--pack-destination',temp])).stdout);
		assert.equal(packed.length,1); tarball=join(temp,packed[0].filename);
	}
	await mkdir(join(providerRoot,'projects','-fixture-project'),{recursive:true});
	await mkdir(join(configHome,'chaching'),{recursive:true});
	const timestamp = new Date().toISOString();
	await writeFile(join(providerRoot,'projects','-fixture-project','package-session.jsonl'), JSON.stringify({
		type:'assistant',timestamp,requestId:'package-request',sessionId:'package-session',cwd:'/fixture/project',isSidechain:false,
		message:{id:'package-message',model:'claude-sonnet-4-6',usage:{input_tokens:1000,output_tokens:500,cache_creation_input_tokens:2000,cache_read_input_tokens:10000}}
	})+'\n');
	await writeFile(join(configHome,'chaching','config.json'),JSON.stringify({
		history:{enabled:false,dbPath:join(temp,'history.db')},tokenmaxx:{enabled:false,dbPath:join(temp,'no-tokenmaxx.db')},sync:{enabled:false,databaseUrl:''},
		providers:{claude:{enabled:true,roots:[providerRoot]},codex:{enabled:false,root:join(temp,'no-codex')},cursor:{enabled:false,adminApiToken:''},opencode:{enabled:false,dbPath:join(temp,'no-opencode.db')},pi:{enabled:false,roots:[]}}
	}));
	const installed=join(temp,'installed'); await mkdir(installed);
	await command('npm',['install','--prefix',installed,'--no-audit','--no-fund','--include=optional',tarball]);
	const packageRoot=join(installed,'node_modules','chaching');
	const manifest=JSON.parse(await readFile(join(packageRoot,'package.json'),'utf8'));
	assert.equal(manifest.name,'chaching'); assert.notEqual(manifest.private,true);
	assert(!JSON.stringify(manifest).includes('workspace:'),'Published manifest must not contain workspace versions');
	assert(!Object.keys(manifest.dependencies || {}).some(name=>name.startsWith('@chaching/')),'Private workspaces must be bundled');
	const launcher=join(packageRoot,'bin','chaching.js');
	const cli=async args=>(await command(process.execPath,[launcher,...args])).stdout;
	assert.match(await cli(['--help']),/chaching/i);
	const stats=JSON.parse(await cli(['stats','--json']));
	assert.equal(stats.totals.requests,1); assert(stats.totals.cost>0); assert.equal(stats.dayModel.length,1);
	const receipt=JSON.parse(await cli(['receipt','--json']));
	assert.equal(receipt.totals.requests,1); assert.equal(receipt.totals.cost,stats.totals.cost);
	assert.match(await cli(['receipt','--no-art']),/TOTAL BURN/);
	const wrapped=JSON.parse(await cli(['wrapped','--json']));
	assert.equal(wrapped.wrapped.headline.cost,stats.totals.cost);
	assert.match(await cli(['wrapped','--no-art']),/total burn/i);
	for(const kind of ['receipt','wrapped']) {
		const path=join(temp,`${kind}.png`); await cli([kind,'--png',path]); await png(path);
	}
	console.log('Packed CLI: seeded stats, receipt, Wrapped and PNG passed.');
	const port=await unusedPort(); const origin=`http://127.0.0.1:${port}`;
	server=spawn(process.execPath,[launcher,'serve','--no-open'],{cwd:temp,env:{...env,HOST:'127.0.0.1',PORT:String(port),ORIGIN:origin},stdio:['ignore','pipe','pipe']});
	server.stdout.on('data',chunk=>{serverOutput+=chunk;}); server.stderr.on('data',chunk=>{serverOutput+=chunk;});
	serverExit=new Promise(done=>server.once('exit',done));
	const page=await waitFor(`${origin}${base}/`); const html=await page.text();
	assert.match(html,/chaching/i);
	const asset=html.match(/(?:src|href)="([^"\s]*_app\/immutable\/[^"\s]+)"/);
	assert(asset,'Dashboard must reference built client assets');
	assert((await fetch(new URL(asset[1],`${origin}${base}/`))).ok,'Dashboard client asset must load');
	const pngResponse=await fetch(`${origin}${base}/api/receipt.png`,{signal:AbortSignal.timeout(30000)});
	assert(pngResponse.ok,`Dashboard PNG route: ${pngResponse.status}`);
	assert(Buffer.from(await pngResponse.arrayBuffer()).subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])));
	console.log(`Packed dashboard: ${base || '/'} and server PNG passed.`);
	await stopServer();
	const lean=join(temp,'without-renderer'); await mkdir(lean);
	await command('npm',['install','--prefix',lean,'--no-audit','--no-fund','--omit=optional',tarball]);
	const leanLauncher=join(lean,'node_modules','chaching','bin','chaching.js');
	assert.match((await command(process.execPath,[leanLauncher,'--help'])).stdout,/chaching/i);
	const absent=join(temp,'must-not-exist.png');
	let failure;
	try {await exec(process.execPath,[leanLauncher,'receipt','--png',absent],{cwd:temp,env,timeout:30000});}catch(error){failure=error;}
	assert(failure,'PNG without optional renderer must fail');
	assert.match(failure.stderr,/renderer dependencies|install.*satori/is);
	await assert.rejects(access(absent));
	console.log('Optional renderer omitted: base CLI works and PNG fails with installation guidance.');
} finally {
	await stopServer();
	await rm(temp,{recursive:true,force:true});
}
