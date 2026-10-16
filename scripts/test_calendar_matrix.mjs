import { spawnSync } from 'node:child_process';
import { readFileSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';

// Each zone runs in a fresh process: changing TZ inside a jsdom worker is unreliable.
const root = fileURLToPath(new URL('../', import.meta.url));
const zones = ['UTC', 'America/New_York', 'Europe/Berlin', 'Asia/Kolkata', 'Pacific/Auckland'];
const results = [];
for (const timezone of zones) {
  const output = join(tmpdir(), `flowmate-calendar-${randomUUID()}.json`);
  const run = spawnSync(process.execPath, [
    resolve(root, 'node_modules/vitest/vitest.mjs'), 'run',
    'tests/calendar_reliability.test.ts', 'tests/deadline_calendar_days.test.tsx',
    'tests/calendar_dates.test.ts',
    '--pool=threads', '--maxWorkers=1', '--reporter=json', `--outputFile=${output}`
  ], { cwd: root, env: { ...process.env, TZ: timezone }, encoding: 'utf8', timeout: 180000, maxBuffer: 4 * 1024 * 1024 });
  let report;
  try { report = JSON.parse(readFileSync(output, 'utf8')); } catch { /* Report unavailable is a failed run. */ }
  try { unlinkSync(output); } catch { /* Only remove this run's unique temporary result. */ }
  results.push({
    timezone, exitCode: run.status, passed: run.status === 0 && report?.success === true,
    tests: report?.numTotalTests ?? null, failed: report?.numFailedTests ?? null,
    failures: report?.testResults?.flatMap(suite => suite.assertionResults
      .filter(test => test.status === 'failed').map(test => test.fullName)) ?? [],
    runnerError: run.error?.message ?? (report ? null : 'No valid Vitest result produced')
  });
  process.stderr.write(`${timezone}: ${results.at(-1).passed ? 'PASS' : 'FAIL'}\n`);
}
console.log(JSON.stringify({ schemaVersion: 1, results, passed: results.every(result => result.passed) }, null, 2));
process.exitCode = results.every(result => result.passed) ? 0 : 1;
