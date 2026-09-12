import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verifyReports } from './verify-ci-tests.mjs';

test('rejects a green run with missing or skipped mandatory integration tests', () => {
  const result = (name, count = 1) => ({ name, assertionResults: Array.from({ length: count }, () => ({ status: 'passed' })) });
  const testResults = [result('serve.test.ts'), result('engine.sync.integration.test.ts'), result('sync/store.integration.test.ts'), result('packages/cli/src/migration.integration.test.ts'), result('pool-rollout.integration.test.ts', 3)];
  const report = { success: true, testResults };
  verifyReports([report], true);
  assert.throws(() => verifyReports([{ ...report, testResults: testResults.slice(0, -1) }], true), /pool-rollout/);
  testResults.at(-1).assertionResults[0].status = 'pending';
  assert.throws(() => verifyReports([report], true), /pool-rollout/);
  assert.throws(() => verifyReports([], false), /no test results/);
  assert.throws(() => verifyReports([{ ...report, success: false }], false), /failed/);
});
