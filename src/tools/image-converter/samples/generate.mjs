import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

async function generate() {
const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const sourceDir = resolve(dirname(fileURLToPath(import.meta.url)));
const outputDir = resolve(root, 'public/samples');
await mkdir(outputDir, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
});
try {
const page = await browser.newPage({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 1 });

async function renderImageData({ mime, data, width, height, quality }) {
  await page.setContent(`<img id="source" src="data:${mime};base64,${data}"><canvas id="output"></canvas>`);
  await page.evaluate(async ({ width, height, quality }) => {
    const image = document.querySelector('#source');
    await image.decode();
    const canvas = document.querySelector('#output');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    window.result = canvas.toDataURL(quality ? 'image/jpeg' : 'image/png', quality ?? undefined);
  }, { width, height, quality });
  return page.evaluate(() => window.result.split(',')[1]);
}

async function writeDataUrl(path, base64) {
  await writeFile(path, Buffer.from(base64, 'base64'));
}

async function rasterizeSvg(name, width, height) {
  const source = await readFile(resolve(sourceDir, `${name}.svg`), 'utf8');
  const base64 = await renderImageData({ mime: 'image/svg+xml', data: Buffer.from(source).toString('base64'), width, height });
  await writeDataUrl(resolve(outputDir, `${name}.png`), base64);
}

const temporarySourceDir = await mkdtemp(resolve(tmpdir(), 'web-toolbox-samples-'));
const photoSource = resolve(temporarySourceDir, 'red-panda.jpg');
let photoData;
try {
  execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', 'https://commons.wikimedia.org/wiki/Special:Redirect/file/Red_Panda_-_52301663056.jpg', '--output', photoSource]);
  photoData = (await readFile(photoSource)).toString('base64');
} finally {
  await rm(temporarySourceDir, { recursive: true, force: true });
}
await writeDataUrl(resolve(outputDir, 'red-panda.jpg'), await renderImageData({
  mime: 'image/jpeg', data: photoData, width: 1280, height: 853, quality: 0.84,
}));
await rasterizeSvg('outline', 1200, 900);

const htmlPath = resolve(sourceDir, 'mobile-screen.html');
const html = await readFile(htmlPath, 'utf8');
const css = await readFile(resolve(sourceDir, 'mobile-screen.css'), 'utf8');
await page.setViewportSize({ width: 900, height: 1600 });
await page.setContent(html.replace('<link rel="stylesheet" href="mobile-screen.css">', `<style>${css}</style>`));
await page.evaluate(() => document.fonts.ready);
await page.screenshot({ path: resolve(outputDir, 'mobile-screen.png'), fullPage: true });

await rasterizeSvg('geometry', 1200, 900);

for (const [id, filename, width, height] of [
  ['red-panda', 'red-panda.jpg', 1280, 853],
  ['outline', 'outline.png', 1200, 900],
  ['mobile-screen', 'mobile-screen.png', 900, 1600],
  ['geometry', 'geometry.png', 1200, 900],
]) {
  const imagePath = resolve(outputDir, filename);
  const mime = filename.endsWith('.jpg') ? 'image/jpeg' : 'image/png';
  const sourceData = (await readFile(imagePath)).toString('base64');
  const thumbnailType = id === 'red-panda' ? 'image/jpeg' : 'image/png';
  const base64 = await page.evaluate(async ({ url, width, height, thumbnailType }) => {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = 160;
    canvas.height = 100;
    const scale = Math.min(canvas.width / width, canvas.height / height);
    const w = Math.round(width * scale);
    const h = Math.round(height * scale);
    canvas.getContext('2d').fillStyle = '#fff';
    canvas.getContext('2d').fillRect(0, 0, canvas.width, canvas.height);
    canvas.getContext('2d').drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    return canvas.toDataURL(thumbnailType, 0.78).split(',')[1];
  }, { url: `data:${mime};base64,${sourceData}`, width, height, thumbnailType });
  await writeDataUrl(resolve(outputDir, `${id}-thumb.${id === 'red-panda' ? 'jpg' : 'png'}`), base64);
}

for (const filename of ['red-panda.jpg', 'outline.png', 'mobile-screen.png', 'geometry.png', 'red-panda-thumb.jpg', 'outline-thumb.png', 'mobile-screen-thumb.png', 'geometry-thumb.png']) {
  const imagePath = resolve(outputDir, filename);
  const image = await page.evaluate(async url => {
    const img = new Image();
    img.src = url;
    await img.decode();
    return { width: img.naturalWidth, height: img.naturalHeight };
  }, `data:${filename.endsWith('.jpg') ? 'image/jpeg' : 'image/png'};base64,${(await readFile(imagePath)).toString('base64')}`);
  const { size } = await import('node:fs/promises').then(fs => fs.stat(imagePath));
  console.log(`${filename}: ${image.width}x${image.height}, ${size} bytes`);
}
} finally {
  await browser.close();
}
}

await generate();
