import { defineConfig } from 'vite';
export default defineConfig({
  server: { allowedHosts: ['latios.piranha-wyvern.ts.net'] },
  build: { outDir: 'dist', rolldownOptions: { input: [
    'index.html', 'docs/index.html', 'docs/commands/index.html', 'docs/configuration/index.html',
    'docs/sync/index.html', 'changelog/index.html', 'licence/index.html'
  ] } }
});
