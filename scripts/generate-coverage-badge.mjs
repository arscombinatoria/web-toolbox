import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function renderCoverageBadge(summary) {
  const percentage = summary?.total?.lines?.pct;
  if (typeof percentage !== 'number' || !Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new Error('total.lines.pct must be a finite number between 0 and 100');
  }
  const value = `${percentage.toFixed(1)}%`;
  const color = percentage >= 90 ? '#4c1' : percentage >= 80 ? '#97ca00' : percentage >= 60 ? '#dfb317' : '#e05d44';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="126" height="20" viewBox="0 0 126 20" role="img" aria-labelledby="title">
  <title id="title">coverage: ${value} (Lines)</title>
  <clipPath id="badge"><rect width="126" height="20" rx="3"/></clipPath>
  <g clip-path="url(#badge)">
    <path fill="#555" d="M0 0h65v20H0z"/>
    <path fill="${color}" d="M65 0h61v20H65z"/>
  </g>
  <g fill="#fff" text-anchor="middle" font-family="Verdana,DejaVu Sans,sans-serif" font-size="11">
    <text x="32.5" y="14">coverage</text>
    <text x="95.5" y="14">${value}</text>
  </g>
</svg>
`;
}

export async function generateCoverageBadge(input = 'coverage/coverage-summary.json', output = 'dist/coverage.svg') {
  let summary;
  try {
    summary = JSON.parse(await readFile(input, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read coverage summary JSON at ${input}: ${error.message}`, { cause: error });
  }
  const svg = renderCoverageBadge(summary);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, svg, 'utf8');
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    await generateCoverageBadge();
  } catch (error) {
    console.error(`Coverage badge generation failed: ${error.message}`);
    process.exitCode = 1;
  }
}
