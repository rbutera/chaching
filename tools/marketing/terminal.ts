import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { seedFixture } from './fixture.ts';

const root = mkdtempSync(join(tmpdir(), 'chaching-terminal-'));
const output = resolve('apps/site/public/shots');
try {
  seedFixture(root);
  mkdirSync(output, { recursive: true });
  const frames = join(root, 'frames');
  const tape = join(root, 'terminal.tape');
  writeFileSync(tape, readFileSync('tools/marketing/terminal.tape', 'utf8').replace('Output "terminal-frames/"', `Output "${frames}/"`));
  const result = spawnSync('vhs', [tape], { stdio: 'inherit', timeout: 120000,
    env: { ...process.env, NO_COLOR: undefined, FORCE_COLOR: '3', CI: undefined, XDG_CONFIG_HOME: join(root, 'config'), CHACHING_DATABASE_URL: process.env.CHACHING_MARKETING_DATABASE_URL ?? '',
      CHACHING_PACKAGE_ROOT: resolve('dist/chaching'), TZ: 'UTC', LANG: 'en_US.UTF-8', USER: 'dev',
      VHS_BROWSER_PATH: process.env.VHS_BROWSER_PATH ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' } });
  assert.equal(result.status, 0, result.error?.message);
  // VHS 0.12 cancels its render context before encoding; export its real frames instead.
  const video = spawnSync('ffmpeg', ['-y', '-framerate', '15', '-i', join(frames, 'frame-text-%05d.png'),
    '-framerate', '15', '-i', join(frames, 'frame-cursor-%05d.png'),
    '-filter_complex', '[0][1]overlay,pad=1440:1000:(ow-iw)/2:(oh-ih)/2:color=0x0e0d0b',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', '-movflags', '+faststart', '-an',
    join(output, 'terminal.mp4')], { encoding: 'utf8' });
  assert.equal(video.status, 0, video.stderr);
  const poster = spawnSync('ffmpeg', ['-y', '-ss', '2', '-i', join(output, 'terminal.mp4'), '-frames:v', '1', join(output, 'terminal.png')], { encoding: 'utf8' });
  assert.equal(poster.status, 0, poster.stderr);
  assert.ok(statSync(join(output, 'terminal.mp4')).size > 10000);
  assert.ok(statSync(join(output, 'terminal.png')).size > 10000);
} finally { rmSync(root, { recursive: true, force: true }); }
