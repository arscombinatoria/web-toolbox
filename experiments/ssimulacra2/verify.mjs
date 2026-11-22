import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { availableParallelism, cpus, release, tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { chromium, firefox } from 'playwright';

const referenceCommand = process.argv[2];
const benchmarkOnly = process.env.SSIM_BENCHMARK_ONLY === '1';
const runReference = promisify(execFile);
const base = '/web-toolbox/';
const dist = fileURLToPath(new URL('./dist/', import.meta.url));
const types = { html: 'text/html', js: 'text/javascript', wasm: 'application/wasm', png: 'image/png' };
const requests = [];
let failWasm = false;
const server = createServer(async (request, response) => {
  const path = request.url;
  requests.push({ path, method: request.method });
  if (request.method !== 'GET' || !path.startsWith(base)) return response.writeHead(404).end();
  const file = path.slice(base.length) || 'index.html';
  if (!/^(?:index\.html|assets\/[\w.-]+)$/.test(file)) return response.writeHead(404).end();
  if (failWasm && file.endsWith('.wasm')) return response.writeHead(503).end();
  try {
    const body = await readFile(join(dist, file));
    response.writeHead(200, { 'Content-Type': types[file.split('.').at(-1)], 'Cache-Control': 'no-store' });
    response.end(body);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(0, '127.0.0.1');
await once(server, 'listening');
const url = `http://127.0.0.1:${server.address().port}${base}`;
const temporary = await mkdtemp(join(tmpdir(), 'ssimulacra2-reference-'));

const correctnessCases = [
  ['photo', 512, 512, 'identity'], ['photo', 512, 512, 'png'],
  ['photo', 512, 512, 'jpeg95'], ['photo', 512, 512, 'jpeg75'], ['photo', 512, 512, 'jpeg30'],
  ['solid', 128, 128, 'identity'], ['solid', 128, 128, 'jpeg75'],
  ['gradient', 257, 129, 'png'], ['gradient', 257, 129, 'jpeg75'],
  ['alpha', 257, 129, 'identity'], ['alpha', 257, 129, 'png'], ['alpha', 257, 129, 'jpeg75'],
  ['gradient', 8, 8, 'identity'], ['gradient', 9, 8, 'jpeg30'],
];
const sizes = [[512, 512], [1024, 1024], [2048, 2048], [4096, 3906]];

async function measure(page, fixture, width, height, conversion, repetitions, exportRgb = false) {
  const firstRequest = requests.length;
  const result = await page.evaluate(async (request) => {
    let ticks = 0;
    let maxGapMs = 0;
    let lastTick = performance.now();
    const start = lastTick;
    const timer = setInterval(() => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - lastTick);
      lastTick = now;
      ticks++;
    }, 16);
    try {
      const { ppm, ...result } = await window.measureSsimulacra2(request, AbortSignal.timeout(120_000));
      const wallMs = performance.now() - start;
      return {
        ...result, wallMs, ticks, maxGapMs: Math.max(maxGapMs, performance.now() - lastTick),
        ppm: ppm?.map((buffer) => new Uint8Array(buffer).toBase64()),
      };
    } finally {
      clearInterval(timer);
    }
  }, { fixture, width, height, conversion, repetitions, exportRgb });
  const assets = requests.slice(firstRequest);
  assert(assets.some(({ path }) => /^\/web-toolbox\/assets\/ssimulacra2-[\w-]+\.wasm$/.test(path)));
  assert(assets.every(({ path, method }) => path.startsWith(base) && method === 'GET'), JSON.stringify(assets));
  assert(result.samples.every(({ score }) => Number.isFinite(score) && score === result.samples[0].score));
  return result;
}

async function compareReference(ppm) {
  const paths = ['reference.ppm', 'distorted.ppm'].map((name) => join(temporary, name));
  const pixels = ppm.map((text) => Buffer.from(text, 'base64'));
  const pixelsEqual = pixels[0].equals(pixels[1]);
  let rgbStart = 0;
  for (let line = 0; line < 3; line++) rgbStart = pixels[0].indexOf(10, rgbStart) + 1;
  let maxChannelDelta = 0;
  for (let i = rgbStart; i < pixels[0].length; i++) {
    maxChannelDelta = Math.max(maxChannelDelta, Math.abs(pixels[0][i] - pixels[1][i]));
  }
  if (!referenceCommand) return { pixelsEqual, maxChannelDelta };
  await Promise.all(paths.map((path, index) => writeFile(path, pixels[index])));
  const { stdout } = await runReference(referenceCommand, paths, { timeout: 30_000 });
  const reference = Number(stdout.trim());
  assert(stdout.trim() && Number.isFinite(reference));
  return { pixelsEqual, maxChannelDelta, reference };
}

async function verifyUi(page) {
  const status = page.getByRole('status');
  const submit = page.getByRole('button', { name: '計測', exact: true });
  const cancel = page.getByRole('button', { name: '中止' });
  await page.locator('[name=fixture]').selectOption('gradient');
  await page.locator('[name=width]').fill('4096');
  await page.locator('[name=height]').fill('3906');
  await submit.click();
  await status.getByText('採点中…', { exact: true }).waitFor();
  await cancel.click();
  await status.getByText('中止しました。', { exact: true }).waitFor();
  assert(await page.locator('#result').isHidden());
  assert(await cancel.isDisabled());
  await submit.click();
  await status.getByText('採点中…', { exact: true }).waitFor();
  await cancel.click();
  await status.getByText('中止しました。', { exact: true }).waitFor();

  await page.locator('[name=width]').fill('64');
  await page.locator('[name=height]').fill('64');
  failWasm = true;
  try {
    await submit.click();
    await status.getByText('Wasm HTTP 503', { exact: true }).waitFor();
    assert(await page.locator('#result').isHidden());
  } finally {
    failWasm = false;
  }
  await submit.click();
  await page.locator('#result').waitFor();
  assert(Number.isFinite(JSON.parse(await page.locator('#result').textContent()).samples[0].score));
  const errors = await page.evaluate(async () => {
    const requests = [
      { width: 7, height: 8, conversion: 'identity' },
      { width: 4096, height: 3907, conversion: 'identity' },
      { width: 8, height: 8, conversion: 'invalid' },
    ];
    const results = [];
    for (const request of requests) {
      try {
        await window.measureSsimulacra2({ fixture: 'gradient', ...request }, AbortSignal.timeout(5000));
        results.push(null);
      } catch (error) {
        results.push(error.message);
      }
    }
    return results;
  });
  assert(errors[0]?.includes('8,192px'));
  assert(errors[1]?.includes('1,600万画素'));
  assert(errors[2]?.includes('変換形式'));
  return { errors, wasmHttpFailure: 503, savedResultAfterCancel: false, recovery: true };
}

try {
  const report = {
    runtime: { node: process.version, os: `${process.platform} ${release()}`, arch: process.arch,
      cpu: cpus()[0]?.model, parallelism: availableParallelism() },
    browsers: {},
  };
  for (const [name, type] of Object.entries({ chromium, firefox })) {
    let browser;
    try {
      browser = await type.launch();
      const page = await browser.newPage();
      const unexpected = [];
      const lifecycles = { opened: 0, closed: 0 };
      page.on('pageerror', (error) => unexpected.push(error.message));
      page.on('request', (request) => {
        if (!request.url().startsWith(url) || request.method() !== 'GET') unexpected.push(request.url());
      });
      page.on('worker', (worker) => {
        lifecycles.opened++;
        worker.on('close', () => lifecycles.closed++);
      });
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        const counts = { created: 0, terminated: 0 };
        window.workerCounts = counts;
        window.Worker = class extends NativeWorker {
          constructor(...args) {
            super(...args);
            counts.created++;
          }
          terminate() {
            super.terminate();
            counts.terminated++;
          }
        };
      });
      await page.goto(url);
      const correctness = [];
      if (!benchmarkOnly) {
        for (const [fixture, width, height, conversion] of correctnessCases) {
          const { ppm, preparation, samples } = await measure(page, fixture, width, height, conversion, 1, true);
          const comparison = await compareReference(ppm);
          const score = samples[0].score;
          if (conversion === 'identity' || (conversion === 'png' && fixture !== 'alpha')) {
            assert(comparison.pixelsEqual);
            assert(Math.abs(score - 100) < 0.01);
          }
          correctness.push({ fixture, width, height, conversion, score, ...comparison, fileBytes: preparation.fileBytes });
        }
      }
      const benchmark = [];
      for (const [width, height] of sizes) {
        const result = await measure(page, 'photo', width, height, 'jpeg75', 3);
        benchmark.push({ width, height, ...result });
        console.error(name, width, height, result.samples.map(({ scoreMs }) => scoreMs.toFixed(0)).join(' / '), 'ms');
      }
      const checks = benchmarkOnly ? undefined : await verifyUi(page);
      const deadline = Date.now() + 5000;
      while (lifecycles.closed < lifecycles.opened && Date.now() < deadline) await delay(100);
      assert.deepEqual(unexpected, []);
      const counts = await page.evaluate(() => window.workerCounts);
      const expected = correctness.length + benchmark.length + (checks ? 7 : 0);
      assert.deepEqual(counts, { created: expected, terminated: expected });
      report.browsers[name] = { version: browser.version(), correctness, benchmark, checks,
        lifecycles: { ...counts, ...lifecycles, stillReportedByPlaywright: page.workers().length } };
    } catch (error) {
      report.browsers[name] = { error: error.stack ?? String(error) };
      process.exitCode = 1;
    } finally {
      await browser?.close();
    }
  }
  console.log(JSON.stringify(report, null, 2));
} finally {
  server.close();
  await rm(temporary, { recursive: true, force: true });
}
