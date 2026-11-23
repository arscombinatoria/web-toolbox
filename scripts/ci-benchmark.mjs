import { mkdir, writeFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { availableParallelism, cpus } from 'node:os';
import { relative } from 'node:path';
import { execFileSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { spawn } from 'node:child_process';

const resultsDirectory = 'benchmark-results';
const vitestReportPath = `${resultsDirectory}/vitest.json`;
const playwrightReportPath = `${resultsDirectory}/playwright.json`;
const scope = process.env.BENCHMARK_SCOPE ?? 'ci';
const pool = process.env.BENCHMARK_VITEST_POOL ?? 'forks';
const workers = Number(process.env.BENCHMARK_WORKERS ?? 3);

await mkdir(resultsDirectory, { recursive: true });
await writeFile(vitestReportPath, '');
await writeFile(playwrightReportPath, '');

const steps = [];
async function run(name, command, args, env = process.env) {
  const started = new Date();
  const start = performance.now();
  const status = await new Promise((resolve) => {
    const child = spawn(command, args, { env, stdio: 'inherit' });
    child.once('error', (error) => resolve({ code: 1, error: error.message }));
    child.once('close', (code, signal) => resolve({ code: code ?? 1, signal }));
  });
  const durationSeconds = (performance.now() - start) / 1000;
  steps.push({ name, startedAt: started.toISOString(), durationSeconds, ...status });
  console.log(`BENCHMARK_STEP ${JSON.stringify(steps.at(-1))}`);
  return status.code;
}

function parseJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

function countPlaywrightTests(report) {
  if (!report) return null;
  const projects = {};
  const tests = [];
  function visit(suite) {
    for (const spec of suite.specs ?? []) {
      for (const test of spec.tests ?? []) {
        tests.push(test);
        const project = test.projectName || 'unknown';
        projects[project] ??= { tests: 0, passed: 0, failed: 0, skipped: 0, flaky: 0, retries: 0 };
        const counts = projects[project];
        counts.tests += 1;
        const results = test.results ?? [];
        counts.retries += Math.max(0, results.length - 1);
        if (test.status === 'expected') counts.passed += 1;
        else if (test.status === 'skipped') counts.skipped += 1;
        else if (test.status === 'flaky') counts.flaky += 1;
        else counts.failed += 1;
      }
    }
    for (const child of suite.suites ?? []) visit(child);
  }
  for (const suite of report.suites ?? []) visit(suite);
  return {
    tests: tests.length,
    passed: tests.filter((test) => test.status === 'expected').length,
    failed: tests.filter((test) => !['expected', 'skipped', 'flaky'].includes(test.status)).length,
    skipped: tests.filter((test) => test.status === 'skipped').length,
    flaky: tests.filter((test) => test.status === 'flaky').length,
    retries: tests.reduce((total, test) => total + Math.max(0, (test.results?.length ?? 0) - 1), 0),
    projects,
  };
}

function coverageTotals() {
  const report = parseJson('coverage/coverage-summary.json');
  if (!report?.total) return null;
  const summary = Object.fromEntries(Object.entries(report.total).map(([key, value]) => [
    key,
    { total: value.total, covered: value.covered, pct: value.pct },
  ]));
  const files = Object.entries(report)
    .filter(([key]) => key !== 'total')
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, values]) => [relative(process.cwd(), path), Object.fromEntries(Object.entries(values).map(([key, value]) => [
      key,
      { total: value.total, covered: value.covered, pct: value.pct },
    ]))]);
  const digest = createHash('sha256').update(JSON.stringify(files)).digest('hex');
  return { summary, fileCount: files.length, fileMetricsSha256: digest };
}

const metadata = {
  runId: process.env.GITHUB_RUN_ID ?? null,
  repository: process.env.GITHUB_REPOSITORY ?? null,
  sha: process.env.GITHUB_SHA ?? null,
  headSha: process.env.BENCHMARK_TARGET_SHA ?? null,
  condition: process.env.BENCHMARK_CASE ?? 'local',
  repetition: Number(process.env.BENCHMARK_REPETITION ?? 0) || null,
  node: process.version,
  npm: execFileSync('npm', ['--version'], { encoding: 'utf8' }).trim(),
  playwrightVersion: JSON.parse(readFileSync('package-lock.json', 'utf8')).packages['node_modules/@playwright/test'].version,
  runnerOs: process.env.ImageOS ?? null,
  runnerImageVersion: process.env.ImageVersion ?? null,
  cpuModel: cpus()[0]?.model ?? null,
  cpuCount: availableParallelism(),
  containerImage: process.env.BENCHMARK_CONTAINER_IMAGE ?? null,
  workers,
  vitestPool: pool,
  isolation: true,
  npmCacheEnabled: process.env.BENCHMARK_NPM_CACHE === 'true',
  npmCacheHit: process.env.BENCHMARK_NPM_CACHE_HIT ?? null,
  scope,
};

console.log(`BENCHMARK_METADATA ${JSON.stringify(metadata)}`);
let failed = false;
async function measure(name, command, args, env = process.env) {
  if ((await run(name, command, args, env)) !== 0) failed = true;
}

await measure('npm ci', 'npm', ['ci']);
const vitestArgs = ['test:coverage', '--', '--reporter=json', `--outputFile=${vitestReportPath}`];
if (pool === 'vmThreads') {
  vitestArgs.push('--pool=vmThreads', '--isolate');
}
await measure('test:coverage', 'npm', ['run', ...vitestArgs]);

if (scope === 'ci') {
  await measure('test:badge', 'npm', ['run', 'test:badge']);
  await measure('build', 'npm', ['run', 'build']);
  if (process.env.BENCHMARK_BROWSER_MODE === 'preinstalled') {
    await measure('browser preparation check (preinstalled image)', 'npx', ['playwright', 'install', '--list']);
  } else {
    await measure('browser preparation', 'npx', ['playwright', 'install', '--with-deps', '--only-shell', 'chromium', 'firefox']);
  }
  const e2eEnv = { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: playwrightReportPath };
  await measure('test:e2e', 'npm', ['run', 'test:e2e', '--', `--workers=${workers}`, '--reporter=github,json'], e2eEnv);
}

const summary = {
  ...metadata,
  steps,
  success: !failed,
  vitest: parseJson(vitestReportPath)?.numTotalTests === undefined ? null : {
    tests: parseJson(vitestReportPath).numTotalTests,
    passed: parseJson(vitestReportPath).numPassedTests,
    failed: parseJson(vitestReportPath).numFailedTests,
    skipped: parseJson(vitestReportPath).numSkippedTests,
    durationMs: parseJson(vitestReportPath).testResults?.reduce((total, result) => total + (result.endTime - result.startTime), 0),
  },
  coverage: coverageTotals(),
  playwright: countPlaywrightTests(parseJson(playwrightReportPath)),
};
const outputPath = `${resultsDirectory}/summary.json`;
await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`);
const encodedSummary = JSON.stringify(summary).replaceAll('%', '%25').replaceAll('\r', '%0D').replaceAll('\n', '%0A');
console.log(`::notice title=CI benchmark result::${encodedSummary}`);
console.log(`BENCHMARK_SUMMARY_FILE ${outputPath}`);
if (failed) process.exitCode = 1;
