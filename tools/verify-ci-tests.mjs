import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export function verifyReports(reports, requirePostgres) {
  const results = reports.flatMap(report => report.testResults ?? []);
  if (!results.length) throw new Error('CI produced no test results');
  if (reports.some(report => report.success !== true)) throw new Error('A test run failed');
  const required = [
    ['serve.test.ts', 1],
    ...(requirePostgres ? [
      ['engine.sync.integration.test.ts', 1],
      ['sync/store.integration.test.ts', 1],
      ['sync/migration.integration.test.ts', 1],
      ['pool-rollout.integration.test.ts', 3]
    ] : [])
  ];
  for (const [suffix, minimum] of required) {
    const matches = results.filter(result => result.name.replaceAll('\\', '/').endsWith(suffix));
    const assertions = matches.flatMap(result => result.assertionResults ?? []);
    if (assertions.length < minimum || assertions.some(test => test.status !== 'passed')) {
      throw new Error(`Required tests did not all run successfully: ${suffix}`);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const directory = process.argv[2] ?? 'reports';
  const paths = readdirSync(directory, { recursive: true }).filter(path => path.endsWith('.json'));
  verifyReports(paths.map(path => JSON.parse(readFileSync(join(directory, path), 'utf8'))), process.env.CHACHING_TEST_PG_TOOLS === '1');
  console.log('Required CI tests ran successfully');
}
