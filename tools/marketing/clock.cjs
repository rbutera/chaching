const RealDate = Date;
const now = RealDate.parse('2026-08-31T18:00:00Z');
global.Date = class extends RealDate {
  constructor(...args) { super(...(args.length ? args : [now])); }
  static now() { return now; }
};
let seed = 17;
Math.random = () => ((seed = Math.imul(seed, 1664525) + 1013904223 >>> 0) / 4294967296);

const os = require('node:os');
os.hostname = () => 'studio';
os.userInfo = () => ({ username: 'dev', homedir: '/home/dev', shell: '/bin/sh', uid: 1000, gid: 1000 });
require('node:module').syncBuiltinESMExports();
