import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { marked } from 'marked';

const escape = text => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
marked.use({ renderer: { heading({ tokens, depth }) {
  const content = this.parser.parseInline(tokens);
  const id = content.replace(/<[^>]+>/g, '').toLowerCase().replace(/[^a-z0-9 -]/g, '').replace(/ +/g, '-');
  return `<h${depth} id="${id}">${content}</h${depth}>\n`;
} } });
const template = readFileSync('apps/site/src/document.html', 'utf8');
const home = template.replaceAll('{{title}}', 'Quietly setting money on fire.').replace('{{path}}', '').replace('{{mainClass}}', 'home').replace('{{content}}', readFileSync('apps/site/src/home.html', 'utf8'));
writeFileSync('apps/site/index.html', home);
const pages = [
  ['docs', 'Start counting', `# Start counting\n\nA local cash register for the money your coding agents are quietly setting on fire.\n\n## Run chaching\n\nRequires **Node >=24.16.0**. Check your version with \`node --version\`.\n\n\`\`\`sh\nnpx chaching\n\`\`\`\n\nThe first-run wizard finds the tools you use and opens the terminal dashboard. For the browser dashboard, run \`chaching serve\`.\n\nTo keep it installed:\n\n\`\`\`sh\nnpm install -g chaching\nchaching\n\`\`\`\n\n## Your data, on your machine\n\nRuns locally. No chaching signup. No telemetry. Claude Code, Codex, OpenCode and Pi / Oh My Pi use local data. Cursor's optional Admin API needs a token. Optional PostgreSQL sync shares aggregates between machines.\n\n## Go further\n\n- [Command reference](/docs/commands/)\n- [Configuration](/docs/configuration/)\n- [Multi-machine sync](/docs/sync/)\n\nBefore sharing an export, use \`--redact\` to remove usernames, hosts and paths.\n\n## Licence\n\nchaching uses [PolyForm Noncommercial 1.0.0](/licence/). For commercial use, [contact Rai](mailto:rai@rbutera.com).`],
  ['docs/configuration', 'Configuration', readFileSync('CONFIG.md', 'utf8')],
  ['docs/sync', 'Multi-machine sync', readFileSync('docs/sync.md', 'utf8')],
  ['changelog', 'Changelog', readFileSync('CHANGELOG.md', 'utf8')],
  ['licence', 'Licence', `# Licence\n\nchaching is licensed under **PolyForm Noncommercial 1.0.0**.\n\nFor commercial licensing, [contact rai@rbutera.com](mailto:rai@rbutera.com).\n\nThe full licence is reproduced below.\n\n<pre class="licence-text">${escape(readFileSync('LICENSE', 'utf8'))}</pre>`],
  ['docs/commands', 'Command reference', `# Command reference\n\nThis reference is generated from the shipping CLI's help output.\n\n<pre>${escape(execFileSync(process.execPath, ['packages/cli/dist/index.js', '--help', '--no-art'], { encoding: 'utf8', env: { ...process.env, NO_COLOR: '1', CHACHING_PACKAGE_ROOT: process.cwd() } }))}</pre>`]
];
for (const [path, title, markdown] of pages) {
  const content = marked.parse(markdown).replaceAll('href="./sync.md"', 'href="/docs/sync/"')
    .replace(/href="(?!https?:|mailto:|\/|#)([^"]+)"/g, (_, target) => `href="https://github.com/rbutera/chaching/blob/main/${path === 'docs/sync' ? 'docs/' : ''}${target}"`);
  mkdirSync(`apps/site/${path}`, { recursive: true });
  writeFileSync(`apps/site/${path}/index.html`, template.replaceAll('{{title}}', title).replace('{{content}}', content).replace('{{path}}', path + '/').replace('{{mainClass}}', 'document wrap'));
}
console.log(`Generated ${pages.length} documentation pages from product sources.`);
