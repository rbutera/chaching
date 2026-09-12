import { spawn } from 'node:child_process';
import { capturePool } from './pool.ts';

const pool = await capturePool();
try {
  for (const script of ['render.ts', 'capture.ts', 'terminal.ts']) {
    await new Promise<void>((resolve, reject) => {
      const child = spawn('pnpm', ['exec', 'tsx', `tools/marketing/${script}`], { stdio: 'inherit',
        env: { ...process.env, CHACHING_MARKETING_DATABASE_URL: pool.databaseUrl, TZ: 'UTC', LANG: 'en_US.UTF-8' } });
      child.on('error', reject);
      child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${script} exited ${code}`)));
    });
  }
} finally { pool.cleanup(); }
