import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { JSDOM } from 'jsdom';
import { generateCoverageBadge, renderCoverageBadge } from './generate-coverage-badge.mjs';

const summary = (pct) => ({ total: { lines: { pct } } });

for (const [pct, display, color] of [
  [0, '0.0', '#e05d44'], [59.9, '59.9', '#e05d44'],
  [60, '60.0', '#dfb317'], [79.9, '79.9', '#dfb317'],
  [80, '80.0', '#97ca00'], [85.234, '85.2', '#97ca00'],
  [89.9, '89.9', '#97ca00'], [90, '90.0', '#4c1'], [100, '100.0', '#4c1'],
]) {
  test(`renders ${pct}% with its threshold color`, () => {
    const svg = renderCoverageBadge(summary(pct));
    assert.ok(svg.includes(`>${display}%</text>`));
    assert.ok(svg.includes(`fill="${color}"`));
    assert.ok(svg.includes(`<title id="title">coverage: ${display}% (Lines)</title>`));
  });
}

test('rejects missing, nonnumeric, nonfinite and out-of-range values', () => {
  for (const value of [undefined, null, '85.2', true, {}, NaN, Infinity, -Infinity, -0.1, 100.1]) {
    assert.throws(() => renderCoverageBadge(summary(value)), /total.lines.pct/);
  }
  for (const value of [undefined, null, {}, { total: {} }, { total: { lines: null } }]) {
    assert.throws(() => renderCoverageBadge(value), /total.lines.pct/);
  }
});

test('creates output directories and reports invalid input with a failing CLI exit code', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'coverage-badge-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = join(root, 'coverage/coverage-summary.json');
  const output = join(root, 'dist/coverage.svg');
  const script = fileURLToPath(new URL('./generate-coverage-badge.mjs', import.meta.url));
  await assert.rejects(generateCoverageBadge(input, output), /Cannot read coverage summary JSON/);
  await mkdir(join(root, 'coverage'));
  for (const invalid of ['{', '{}', '{"total":{"lines":{"pct":101}}}', '{"total":{"lines":{"pct":1e400}}}']) {
    await writeFile(input, invalid);
    await assert.rejects(generateCoverageBadge(input, output));
    const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Coverage badge generation failed:/);
    await assert.rejects(readFile(output), { code: 'ENOENT' });
  }
  await writeFile(input, JSON.stringify(summary(85.234)));
  const result = spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const svg = await readFile(output, 'utf8');
  assert.equal(svg, renderCoverageBadge(summary(85.234)));
  // Reuse the existing jsdom dependency to parse the actual file as XML.
  const dom = new JSDOM(svg, { contentType: 'image/svg+xml' });
  t.after(() => dom.window.close());
  const document = dom.window.document;
  assert.equal(document.documentElement.namespaceURI, 'http://www.w3.org/2000/svg');
  assert.equal(document.documentElement.localName, 'svg');
  assert.equal(document.querySelector('parsererror'), null);
  assert.equal(document.getElementById('title').textContent, 'coverage: 85.2% (Lines)');
});
