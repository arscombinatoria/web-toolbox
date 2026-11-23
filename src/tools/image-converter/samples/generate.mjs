import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { chromium } from '@playwright/test';

const photoUrl = 'https://thumb.wikimedia.org/wikipedia/commons/thumb/e/e6/Red_Panda_-_52301663056.jpg/3840px-Red_Panda_-_52301663056.jpg?download';
const photoSha256 = '149f3498bd8c74f1a109a1e98d55618943afa684057a56ce94cc7c80c4936b4b';

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

async function renderImageData({ mime, data, width, height }) {
  await page.setContent(`<img id="source" src="data:${mime};base64,${data}"><canvas id="output"></canvas>`);
  await page.evaluate(async ({ width, height }) => {
    const image = document.querySelector('#source');
    await image.decode();
    const canvas = document.querySelector('#output');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(image, 0, 0, width, height);
    window.result = canvas.toDataURL('image/png');
  }, { width, height });
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
let photoBytes;
try {
  const metadata = execFileSync('curl', ['--fail', '--location', '--silent', '--show-error', '--write-out', '%{http_code}\n%{content_type}', photoUrl, '--output', photoSource], { encoding: 'utf8' });
  const [status, contentType] = metadata.trimEnd().split('\n');
  if (status !== '200') throw new Error(`Wikimedia JPEG取得失敗: HTTP ${status ?? '不明'} (${photoUrl})`);
  if (contentType?.split(';', 1)[0]?.trim().toLowerCase() !== 'image/jpeg') {
    throw new Error(`Wikimedia JPEG取得失敗: Content-Typeがimage/jpegではありません (${contentType || 'なし'})`);
  }
  photoBytes = await readFile(photoSource);
} catch (error) {
  throw new Error(`Wikimedia JPEGを取得できませんでした (${photoUrl})。ネットワーク接続と配布元の応答を確認してください。原因: ${error.message}`, { cause: error });
} finally {
  await rm(temporarySourceDir, { recursive: true, force: true });
}
const photoData = photoBytes.toString('base64');
const photoDimensions = await page.evaluate(async data => {
  const image = new Image();
  image.src = `data:image/jpeg;base64,${data}`;
  await image.decode();
  return { width: image.naturalWidth, height: image.naturalHeight };
}, photoData);
if (photoDimensions.width !== 3840 || photoDimensions.height !== 2560) {
  throw new Error(`Wikimedia JPEG寸法不一致: expected 3840×2560, received ${photoDimensions.width}×${photoDimensions.height}。URLの派生サイズまたは画像差し替えを確認してください。`);
}
const actualPhotoSha256 = createHash('sha256').update(photoBytes).digest('hex');
if (actualPhotoSha256 !== photoSha256) {
  throw new Error(`Wikimedia JPEGのSHA-256不一致: expected ${photoSha256}, received ${actualPhotoSha256} (${photoBytes.length} bytes)。配布元の画像更新または応答内容の変更を確認してください。`);
}
console.log(`red-panda.jpg source: ${photoDimensions.width}x${photoDimensions.height}, ${photoBytes.length} bytes, SHA-256 ${actualPhotoSha256}`);
await writeFile(resolve(outputDir, 'red-panda.jpg'), photoBytes);
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
  ['red-panda', 'red-panda.jpg', 3840, 2560],
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
