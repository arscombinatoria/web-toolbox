import { readFile } from 'node:fs/promises';
import { deflateSync, inflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import type { FileChooser, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';
import { formatFileSize, sizeChange } from '../src/tools/image-converter/encoder';
import { isJxl } from '../src/tools/image-converter/jxl/signature';
import { jxlProbeBlob } from '../src/tools/image-converter/jxl/support';
import { imageWorkerLockName } from '../src/tools/image-converter/worker-slot';

async function testImage(page: Page, width = 64, height = 32) {
  const png = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(width / 2, 0, width / 2, height);
    return canvas.toDataURL().split(',')[1]!;
  }, { width, height });
  return { name: 'sample.alpha.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}

function crc32(data: Buffer) {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer) {
  const name = Buffer.from(type);
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(Buffer.concat([name, data])));
  return Buffer.concat([length, name, data, checksum]);
}

function rgbaPng(width: number, height: number, alphaLevels = [0, 64, 128, 255]) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 6, 0, 0, 0], 8);
  const rows = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    const row = y * (width * 4 + 1);
    rows[row] = 0;
    for (let x = 0; x < width; x++) {
      const i = row + 1 + x * 4;
      rows[i] = x * 37 + y * 13 & 255;
      rows[i + 1] = x * 11 + y * 29 & 255;
      rows[i + 2] = x * 19 + y * 7 & 255;
      rows[i + 3] = alphaLevels[(x + y) % alphaLevels.length]!;
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(rows)), pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function readRgbaPng(png: Buffer) {
  let width = 0, height = 0, bitDepth = 0, colorType = 0, interlace = 0;
  const compressed: Buffer[] = [];
  for (let cursor = 8; cursor < png.length;) {
    const length = png.readUInt32BE(cursor);
    const type = png.toString('ascii', cursor + 4, cursor + 8);
    const chunk = png.subarray(cursor + 8, cursor + 8 + length);
    if (type === 'IHDR') {
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4);
      bitDepth = chunk[8]!; colorType = chunk[9]!; interlace = chunk[12]!;
    }
    if (type === 'IDAT') compressed.push(chunk);
    cursor += 12 + length;
  }
  if (bitDepth !== 8 || colorType !== 6 || interlace !== 0) return { width, height, bitDepth, colorType, interlace };
  const data = inflateSync(Buffer.concat(compressed));
  const stride = width * 4;
  const pixels = Buffer.alloc(stride * height);
  const paeth = (a: number, b: number, c: number) => {
    const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
    return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
  };
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)]!;
    for (let x = 0; x < stride; x++) {
      const raw = data[y * (stride + 1) + 1 + x]!;
      const left = x >= 4 ? pixels[y * stride + x - 4]! : 0;
      const above = y > 0 ? pixels[(y - 1) * stride + x]! : 0;
      const upperLeft = y > 0 && x >= 4 ? pixels[(y - 1) * stride + x - 4]! : 0;
      const predictor = filter === 1 ? left : filter === 2 ? above : filter === 3 ? Math.floor((left + above) / 2) : filter === 4 ? paeth(left, above, upperLeft) : 0;
      pixels[y * stride + x] = (raw + predictor) & 255;
    }
  }
  return { width, height, bitDepth, colorType, interlace, pixels };
}

async function dragDividerOutsideStage(page: Page, split: Locator) {
  const stage = page.locator('.image-stage');
  await split.scrollIntoViewIfNeeded();
  const splitBounds = (await split.boundingBox())!;
  const stageBounds = (await stage.boundingBox())!;
  const start = { x: splitBounds.x + splitBounds.width / 2, y: splitBounds.y + splitBounds.height / 2 };
  const endX = Math.max(1, stageBounds.x - 10);
  const viewport = page.viewportSize()!;
  expect(start.x).toBeGreaterThanOrEqual(0);
  expect(start.x).toBeLessThan(viewport.width);
  expect(start.y).toBeGreaterThanOrEqual(0);
  expect(start.y).toBeLessThan(viewport.height);
  expect(endX).toBeLessThan(stageBounds.x);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(endX, start.y);
  await page.mouse.up();
}

async function pauseUiClock(page: Page) {
  const start = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
}

async function saveImage(page: Page, button: Locator, filename: string) {
  await expect(button).toBeEnabled();
  const downloading = page.waitForEvent('download');
  await button.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(filename);
  return readFile((await download.path())!);
}

async function saveBrowserImage(page: Page, button: Locator, filename: string, browserName: string) {
  await expect(button).toBeEnabled();
  if (browserName !== 'firefox') return saveImage(page, button, filename);
  const downloading = page.waitForEvent('download', { timeout: 10_000 })
    .then(download => ({ kind: 'download' as const, download }), () => undefined);
  const opened = page.context().waitForEvent('page', { timeout: 10_000 })
    .then(popup => ({ kind: 'page' as const, popup }), () => undefined);
  await button.click({ noWaitAfter: true });
  const result = await Promise.race([downloading, opened]);
  if (!result) throw new Error('Firefox did not start a download or open the saved image.');
  if (result.kind === 'download') {
    expect(result.download.suggestedFilename()).toBe(filename);
    return readFile((await result.download.path())!);
  }
  try {
    const path = fileURLToPath(result.popup.url());
    expect(path.endsWith(filename)).toBe(true);
    return await readFile(path);
  } finally {
    await result.popup.close({ runBeforeUnload: false });
  }
}

async function firstPixel(preview: Locator) {
  return preview.evaluate(img => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img as HTMLImageElement, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
}

test('SSIMULACRA2の目安表はクリック・Enterで開き、狭い画面にも収まる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  const guide = page.locator('.image-score-guide');
  const summary = guide.getByText('スコアの目安を見る', { exact: true });

  await expect(guide).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide.getByRole('row')).toHaveCount(10);
  await expect(guide.getByRole('link', { name: 'SSIMULACRA2公式の使用方法' })).toHaveAttribute('href', 'https://github.com/cloudinary/ssimulacra2#usage');
  await summary.press('Enter');
  await expect(guide).not.toHaveAttribute('open', '');
  await summary.press('Enter');
  await expect(guide).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('画像を選択し、比較線と左右のエンコーダーを操作して個別に保存する', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /画像を選択/ }).press('Space');
  await (await picker).setFiles(image);
  await expect(page.getByRole('button', { name: '画像を変更' })).toBeFocused();
  const saveLeft = page.getByRole('button', { name: '左をダウンロード' });
  const saveRight = page.getByRole('button', { name: '右をダウンロード' });
  const previewLeft = page.getByAltText('左側のプレビュー');
  const previewRight = page.getByAltText('右側のプレビュー');
  const formatLeft = page.getByLabel('左の出力形式');
  const formatRight = page.getByLabel('右の出力形式');
  const qualityLeft = page.getByRole('slider', { name: '左のJPEG品質' });
  const qualityRight = page.getByRole('slider', { name: '右のJPEG品質' });
  const leftPanel = page.getByRole('group', { name: '左の設定' });
  const rightPanel = page.getByRole('group', { name: '右の設定' });

  await expect(saveLeft).toBeEnabled();
  await expect(saveRight).toBeEnabled();
  await expect(formatLeft).toHaveValue('original');
  await expect(formatRight).toHaveValue('image/jpeg');
  await expect(qualityRight).toHaveValue('0.75');
  await expect(qualityLeft).toBeHidden();
  await expect(page.getByRole('img', { name: '元画像のプレビュー' })).toBeVisible();
  await expect(previewRight).toBeVisible();
  await expect(page.locator('.image-info')).toContainText('64 × 32 px');
  await expect(leftPanel.getByRole('status')).toHaveText(/0% 元 /);
  const leftBounds = (await leftPanel.boundingBox())!;
  const rightBounds = (await rightPanel.boundingBox())!;
  expect(leftBounds.y).toBe(rightBounds.y);
  expect(leftBounds.x + leftBounds.width).toBeLessThan(rightBounds.x);

  const split = page.getByRole('slider', { name: '比較位置' });
  const initialUrl = await previewRight.getAttribute('src');
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await split.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '51');
  await expect(split).toHaveAttribute('aria-valuetext', '左側 51%');
  await expect(page.locator('.image-position-control')).toHaveCount(0);
  await dragDividerOutsideStage(page, split);
  expect(Number(await split.getAttribute('aria-valuenow'))).toBeLessThan(30);
  await expect(previewRight).toHaveAttribute('src', initialUrl!);

  await formatLeft.selectOption('image/jpeg');
  await qualityLeft.fill('0.35');
  await qualityRight.press('ArrowLeft');
  await expect(qualityRight).toHaveValue('0.74');
  await expect(qualityLeft).toHaveValue('0.35');
  await expect(saveRight).toBeEnabled();
  await expect(previewRight).not.toHaveAttribute('src', initialUrl!);
  const leftJpeg = await saveImage(page, saveLeft, 'sample.alpha-left-q0.35.jpg');
  const rightJpeg = await saveImage(page, saveRight, 'sample.alpha-right-q0.74.jpg');
  expect([...leftJpeg.subarray(0, 3)]).toEqual([255, 216, 255]);
  expect([...rightJpeg.subarray(0, 3)]).toEqual([255, 216, 255]);

  await formatRight.selectOption('image/png');
  await expect(qualityRight).toBeHidden();
  const png = await saveImage(page, saveRight, 'sample.alpha-right.png');
  expect([...png.subarray(0, 3)]).toEqual([137, 80, 78]);
  const percentFormat = new Intl.NumberFormat('ja-JP', { signDisplay: 'exceptZero', maximumFractionDigits: 2 });
  const formatFileSize = (bytes: number) => {
    if (bytes < 1_000) return `${new Intl.NumberFormat('ja-JP').format(bytes)} B`;
    const unit = bytes < 1_000_000 ? 'KB' : 'MB';
    const divisor = unit === 'KB' ? 1_000 : 1_000_000;
    return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(bytes / divisor)} ${unit}`;
  };
  for (const [panel, bytes] of [[leftPanel, leftJpeg], [rightPanel, png]] as const) {
    const percent = (bytes.length - image.buffer.length) / image.buffer.length * 100;
    await expect(panel.getByRole('status')).toHaveText(
      `${percentFormat.format(percent)}% 元 ${formatFileSize(image.buffer.length)} → 出力 ${formatFileSize(bytes.length)}`,
    );
  }
  await expect(page.getByText('左右比較', { exact: false })).toHaveCount(0);
  await expect(page.locator('.image-comparison')).toHaveCount(0);
  expect((await firstPixel(previewRight))[3]).toBe(0);
  expect(Math.min(...await firstPixel(previewLeft))).toBeGreaterThan(245);

  await formatLeft.selectOption('image/png');
  await expect(qualityLeft).toBeHidden();
  await formatRight.selectOption('image/jpeg');
  await expect(qualityRight).toHaveValue('0.74');
  await expect(saveLeft).toBeEnabled();
  await expect(saveRight).toBeEnabled();
  expect((await firstPixel(previewLeft))[3]).toBe(0);
  expect(Math.min(...await firstPixel(previewRight))).toBeGreaterThan(245);
  await formatLeft.selectOption('image/jpeg');
  await expect(qualityLeft).toHaveValue('0.35');

  await formatLeft.selectOption('original');
  await formatRight.selectOption('original');
  await expect(page.getByRole('img', { name: '元画像のプレビュー' })).toBeVisible();
  await expect(page.locator('.image-original-layer')).toHaveClass(/image-original-left.*image-original-right|image-original-right.*image-original-left/);
  await expect(page.locator('.image-stage canvas')).toHaveCount(1);
  await expect(leftPanel.getByRole('status')).toHaveText(/0% 元 /);
  await expect(rightPanel.getByRole('status')).toHaveText(/0% 元 /);
  expect(await saveImage(page, saveLeft, image.name)).toEqual(image.buffer);
  expect(await saveImage(page, saveRight, image.name)).toEqual(image.buffer);

  await page.getByRole('navigation').getByRole('link', { name: '全角・半角変換' }).click();
  await page.goBack();
  await expect(page.locator('.image-drop')).toBeVisible();
  await expect(saveLeft).toBeHidden();
  await expect(saveRight).toBeHidden();
});

test('Oxipng WASM preserves normalized RGBA by default and exposes interlace and transparent-RGB options', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const inputPng = rgbaPng(127, 97);
  await page.locator('[type=file]').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: inputPng });
  const format = page.getByLabel('右の出力形式');
  const level = page.getByLabel('右のOxipngレベル');
  const interlace = page.getByLabel('右のインターレースを有効にする');
  const alpha = page.getByLabel('右の完全透明画素のRGB最適化を有効にする');
  const status = page.locator('.image-panel[data-side="right"] .image-oxipng-status');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await expect(format.locator('option[value="oxipng"]')).toHaveText('Oxipng');
  await format.selectOption('oxipng');
  await expect(level).toHaveValue('2');
  await expect(interlace).not.toBeChecked();
  await expect(alpha).not.toBeChecked();
  await expect(status).toContainText('完了');
  await expect(page.locator('.image-score').last()).toHaveText('可逆圧縮（スコア評価対象外）');
  await expect(page.locator('.image-result').last()).toContainText('→ 出力');
  const baseline = await page.locator('canvas').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    return [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data];
  });
  const defaultPng = await saveImage(page, save, 'sample-right-oxipng-o2.png');
  const decodedDefault = readRgbaPng(defaultPng);
  expect(decodedDefault).toMatchObject({ width: 127, height: 97, bitDepth: 8, colorType: 6, interlace: 0 });
  expect([...decodedDefault.pixels!]).toEqual(baseline);
  await expect(page.getByAltText('右側のプレビュー')).toBeVisible();
  await expect(page.locator('.image-panel[data-side="right"] .image-size-change')).toHaveText(sizeChange(inputPng.length, defaultPng.length));
  await expect(page.locator('.image-panel[data-side="right"] .image-output-size')).toContainText(formatFileSize(defaultPng.length));

  await page.getByLabel('左の出力形式').selectOption('oxipng');
  await expect(page.locator('.image-panel[data-side="left"] .image-oxipng-status')).toContainText('完了');
  await expect(page.getByAltText('左側のプレビュー')).toBeVisible();
  const leftPng = await saveImage(page, page.getByRole('button', { name: '左をダウンロード' }), 'sample-left-oxipng-o2.png');
  expect(leftPng.equals(defaultPng)).toBe(true);
  await expect(page.locator('.image-panel[data-side="left"] .image-size-change')).toHaveText(sizeChange(inputPng.length, leftPng.length));

  await alpha.check();
  await expect(status).toContainText('完了');
  const alphaPng = await saveImage(page, save, 'sample-right-oxipng-o2.png');
  const decodedAlpha = readRgbaPng(alphaPng);
  expect(decodedAlpha).toMatchObject({ width: 127, height: 97, interlace: 0 });
  for (let pixel = 0; pixel < baseline.length; pixel += 4) {
    if (baseline[pixel + 3] !== 0) expect([...decodedAlpha.pixels!.subarray(pixel, pixel + 4)]).toEqual(baseline.slice(pixel, pixel + 4));
  }

  await level.selectOption('6');
  await interlace.check();
  await expect(status).toContainText('完了');
  const interlaced = await saveImage(page, save, 'sample-right-oxipng-o6.png');
  expect(readRgbaPng(interlaced)).toMatchObject({ width: 127, height: 97, interlace: 1 });
  await level.focus();
  await level.press('ArrowUp');
  await expect(level).toHaveValue('5');
  await page.setViewportSize({ width: 320, height: 800 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await format.selectOption('image/png');
  await expect(level).toBeHidden();
  expect(await level.evaluate(element => {
    (element as HTMLSelectElement).focus();
    return document.activeElement === element;
  })).toBe(false);
});

test('AVIF single-thread WASM creates lossless odd-sized RGBA, previews, saves and accepts the saved AVIF as input', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  await page.goto('./?tool=image-converter');
  const inputPng = rgbaPng(127, 97);
  const input = page.locator('[type=file]');
  await input.setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: inputPng });
  await expect(page.locator('.image-info')).toContainText('127 × 97 px');
  const baseline = await page.locator('.image-original-layer canvas').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    return [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data];
  });
  const format = page.getByLabel('右の出力形式');
  const quality = page.getByLabel('右のAVIF品質');
  const speed = page.getByLabel('右のAVIF速度');
  const alphaQuality = page.getByLabel('右のAVIFアルファ品質');
  const subsample = page.getByLabel('右のAVIF色差サンプリング');
  const lossless = page.getByLabel('右側のAVIFを可逆圧縮にする');
  const preview = page.locator('.image-stage img[data-side="right"]');
  const status = page.locator('.image-panel[data-side="right"] .image-avif-status');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await format.selectOption('image/avif');
  await expect(status).toContainText('完了');
  await expect(quality).toHaveValue('50');
  await expect(alphaQuality).toHaveValue('100');
  await expect(page.getByLabel('右のAVIF速度')).toHaveValue('6');
  await expect(subsample).toHaveValue('1');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('naturalWidth', 127);
  await expect(preview).toHaveJSProperty('naturalHeight', 97);
  const defaultAvif = await saveBrowserImage(page, save, 'sample-right-avif-q50-a100-s6-420.avif', browserName);
  expect(defaultAvif.toString('ascii', 4, 8)).toBe('ftyp');
  expect(defaultAvif.toString('ascii', 8, 12)).toBe('avif');
  if (browserName === 'firefox') {
    await page.goto('./?tool=image-converter');
    await input.setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: inputPng });
    await expect(page.locator('.image-info')).toContainText('127 × 97 px');
    await format.selectOption('image/avif');
    await expect(status).toContainText('完了');
  }

  await quality.fill('100');
  await alphaQuality.fill('100');
  await subsample.selectOption('3');
  await expect(lossless).not.toBeChecked();
  await expect(save).toBeDisabled();
  await expect(save).toBeEnabled();
  await expect(status).toContainText('完了');
  await expect(page.locator('.image-score').last()).toHaveText('可逆圧縮（スコア評価対象外）');
  const losslessAvif = await saveBrowserImage(page, save, 'sample-right-avif-lossless-s6.avif', browserName);
  if (browserName === 'firefox') await page.goto('./?tool=image-converter');
  const decoded = await page.evaluate(async encoded => {
    const image = await createImageBitmap(new Blob([new Uint8Array(encoded)], { type: 'image/avif' }));
    try {
      const canvas = new OffscreenCanvas(image.width, image.height);
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0);
      return { width: image.width, height: image.height, rgba: [...context.getImageData(0, 0, image.width, image.height).data] };
    } finally {
      image.close();
    }
  }, [...losslessAvif]);
  expect(decoded.width).toBe(127);
  expect(decoded.height).toBe(97);
  expect(decoded.rgba).toEqual(baseline);

  await input.setInputFiles({ name: 'roundtrip.avif', mimeType: 'image/avif', buffer: losslessAvif });
  await expect(page.locator('.image-info')).toContainText('roundtrip.avif');
  await expect(page.locator('.image-info')).toContainText('127 × 97 px');
  await format.selectOption('image/avif');
  await expect(status).toContainText('完了');
  await expect(page.getByAltText('右側のプレビュー')).toHaveJSProperty('naturalWidth', 127);

  await page.setViewportSize({ width: 320, height: 800 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  }
  await speed.focus();
  await speed.press('ArrowUp');
  await expect(speed).toHaveValue('7');
  await expect(status).toContainText('完了');
});

test('mixed JPEG and AVIF outputs are evaluated together by the local SSIMULACRA2 worker', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = rgbaPng(128, 96);
  const avifWasm = page.waitForResponse('**/assets/avif_enc-*.wasm');
  const scorerWasm = page.waitForResponse('**/assets/ssimulacra2-0.1.0-*.wasm');
  await page.locator('[type=file]').setInputFiles({ name: 'mixed.png', mimeType: 'image/png', buffer: image });
  await expect(page.locator('.image-info')).toContainText('128 × 96 px');
  await page.getByLabel('左の出力形式').selectOption('image/avif');
  await expect(page.locator('.image-panel[data-side=left] .image-avif-status')).toContainText('完了');
  await expect(page.locator('.image-evaluation-status')).toContainText('完了', { timeout: 30_000 });
  expect((await avifWasm).ok()).toBe(true);
  expect((await scorerWasm).ok()).toBe(true);
  await expect(page.locator('.image-panel[data-side=left] .image-score')).toHaveText(/^-?\d+\.\d$/);
  await expect(page.locator('.image-panel[data-side=right] .image-score')).toHaveText(/^-?\d+\.\d$/);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('AVIF Wasm loading can be canceled, fail and retry without leaving a Worker or lock behind', async ({ page }) => {
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  await page.locator('.image-evaluation-toggle input').uncheck();
  await page.locator('.image-sample[data-sample="outline"]').click();
  const format = page.getByLabel('右の出力形式');
  const status = page.locator('.image-panel[data-side="right"] .image-avif-status');
  const cancel = page.getByRole('button', { name: '右側のAVIF変換を中止' });
  const retry = page.getByRole('button', { name: '右側のAVIF変換を再試行' });
  const save = page.getByRole('button', { name: '右をダウンロード' });
  const wasm = '**/assets/avif_enc-*.wasm';
  const avifLockHeld = () => page.evaluate(async lockName => {
    const { held } = await navigator.locks.query();
    return held?.some(lock => lock.name === lockName) ?? false;
  }, imageWorkerLockName);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(wasm, async route => {
    await blocked;
    await route.abort().catch(() => {});
  }, { times: 1 });
  try {
    const requested = page.waitForRequest(wasm);
    await format.selectOption('image/avif');
    await requested;
    await expect(status).toContainText('変換しています');
    await expect.poll(avifLockHeld).toBe(true);
    await cancel.click();
    await expect(status).toContainText('中止しました');
    await expect(retry).toBeVisible();
    await expect(save).toBeDisabled();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect.poll(avifLockHeld).toBe(false);
  } finally {
    release();
  }

  await page.route(wasm, route => route.fulfill({ status: 503 }), { times: 1 });
  await retry.click();
  await expect(status).toContainText('失敗');
  await expect(retry).toBeVisible();
  await expect.poll(() => page.workers().length).toBe(0);
  await retry.click();
  await expect(status).toContainText('完了', { timeout: 30_000 });
  await expect(save).toBeEnabled();
  await expect.poll(() => page.workers().length).toBe(0);
});

test('Oxipng accepts JPEG, PNG and WebP browser-normalized inputs', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const fileInput = page.locator('[type=file]');
  for (const mimeType of ['image/jpeg', 'image/webp']) {
    const encoded = await page.evaluate(async type => {
      const canvas = document.createElement('canvas');
      canvas.width = 32; canvas.height = 24;
      const context = canvas.getContext('2d')!;
      context.fillStyle = 'rgb(70, 120, 210)';
      context.fillRect(0, 0, 32, 24);
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(value => resolve(value!), type));
      return { name: `input.${type.split('/')[1]}`, mimeType: type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
    }, mimeType);
    const image = { name: encoded.name, mimeType: encoded.mimeType, buffer: Buffer.from(encoded.bytes) };
    await fileInput.setInputFiles(image);
    await expect(page.locator('.image-filename')).toHaveText(encoded.name);
    await page.getByLabel('左の出力形式').selectOption('oxipng');
    await expect(page.locator('.image-panel[data-side="left"] .image-oxipng-status')).toContainText('完了');
    const output = await saveImage(page, page.getByRole('button', { name: '左をダウンロード' }), `${encoded.name.replace(/\.[^.]*$/, '')}-left-oxipng-o2.png`);
    expect(readRgbaPng(output)).toMatchObject({ width: 32, height: 24, interlace: 0 });
    await page.getByLabel('左の出力形式').selectOption('original');
  }
});

test('Oxipng cancellation and retry terminate and recreate the real production worker', async ({ page }) => {
  test.setTimeout(60000);
  let releaseFirstRequest!: () => void;
  let firstRequestStarted!: () => void;
  const firstWasmRequest = new Promise<void>(resolve => { firstRequestStarted = resolve; });
  const holdFirstRequest = new Promise<void>(resolve => { releaseFirstRequest = resolve; });
  let wasmRequests = 0;
  await page.route(/squoosh_oxipng_bg.*\.wasm$/, async route => {
    wasmRequests++;
    if (wasmRequests === 1) {
      firstRequestStarted();
      await holdFirstRequest;
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.addInitScript(() => {
    const events: { action: string; name: string }[] = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      readonly observedName: string;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.observedName = options?.name ?? '';
        events.push({ action: 'create', name: this.observedName });
      }
      override terminate() {
        events.push({ action: 'terminate', name: this.observedName });
        super.terminate();
      }
    };
    (window as unknown as { __workerEvents: typeof events }).__workerEvents = events;
  });
  await page.goto('./?tool=image-converter');
  await page.locator('.image-evaluation-toggle input').uncheck();
  await page.locator('.image-sample[data-sample="outline"]').click();
  await expect(page.locator('.image-filename')).toHaveText('outline.png');
  const format = page.getByLabel('右の出力形式');
  const status = page.locator('.image-panel[data-side="right"] .image-oxipng-status');
  const cancel = page.getByRole('button', { name: '右側のOxipngを中止' });
  const retry = page.getByRole('button', { name: '右側のOxipngを再試行' });
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await format.selectOption('oxipng');
  await firstWasmRequest;
  await cancel.click();
  releaseFirstRequest();
  await expect(status).toContainText('中止しました');
  await expect(retry).toBeVisible();
  await expect(save).toBeDisabled();
  await retry.click();
  await expect(cancel).toBeFocused();
  await expect(status).toContainText('完了', { timeout: 30000 });
  await expect(save).toBeEnabled();
  await expect(cancel).toBeHidden();
  expect(wasmRequests).toBe(2);
  const events = await page.evaluate(() => (window as unknown as { __workerEvents: { action: string; name: string }[] }).__workerEvents);
  expect(events.filter(event => event.action === 'create' && event.name === 'image-converter-oxipng')).toHaveLength(2);
  expect(events.filter(event => event.action === 'terminate' && event.name === 'image-converter-oxipng')).toHaveLength(2);
});

test('Oxipng and AVIF load lazily from same-origin /web-toolbox assets, without sending image requests externally', async ({ page }) => {
  const external: string[] = [];
  const requests: string[] = [];
  page.on('request', request => {
    const url = new URL(request.url());
    if (url.origin !== 'http://127.0.0.1:4173') external.push(request.url());
    else requests.push(url.pathname);
  });
  await page.goto('./');
  await expect(page.locator('body')).toBeVisible();
  await page.goto('./?tool=image-converter');
  await page.locator('.image-evaluation-toggle input').uncheck();
  expect(requests.some(path => /oxipng|squoosh|avif|\.wasm|worker-/i.test(path))).toBe(false);
  await page.locator('.image-sample[data-sample="outline"]').click();
  await expect(page.locator('.image-filename')).toHaveText('outline.png');
  await page.getByLabel('左の出力形式').selectOption('oxipng');
  await expect(page.locator('.image-panel[data-side="left"] .image-oxipng-status')).toContainText('完了');
  expect(requests.some(path => path.endsWith('.wasm') && path.startsWith('/web-toolbox/assets/'))).toBe(true);
  expect(requests.some(path => /worker-.*\.js$/.test(path) && path.startsWith('/web-toolbox/assets/'))).toBe(true);
  expect(requests.some(path => /avif/i.test(path))).toBe(false);
  expect(external).toEqual([]);
});

test('Oxipng, AVIF, WebP and automatic SSIMULACRA2 workers run one at a time', async ({ page }) => {
  test.setTimeout(90000);
  await page.addInitScript(() => {
    const events: { action: string; name: string; at: number; url: string }[] = [];
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      readonly observedName: string;
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.observedName = options?.name ?? '';
        events.push({ action: 'create', name: this.observedName, at: performance.now(), url: String(url) });
      }
      override terminate() {
        events.push({ action: 'terminate', name: this.observedName, at: performance.now(), url: '' });
        super.terminate();
      }
    };
    (window as unknown as { __workerEvents: typeof events }).__workerEvents = events;
  });
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  await page.locator('.image-sample[data-sample="geometry"]').click();
  await expect(page.locator('.image-filename')).toHaveText('geometry.png');
  const wasm = '**/assets/avif_enc-*.wasm';
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(wasm, async route => { await blocked; await route.continue(); }, { times: 1 });
  const avifRequest = page.waitForRequest(wasm);
  await page.getByLabel('左の出力形式').selectOption('image/avif');
  await avifRequest;
  await page.getByLabel('右の出力形式').selectOption('oxipng');
  const oxipngStatus = page.locator('.image-panel[data-side="right"] .image-oxipng-status');
  await expect(oxipngStatus).toContainText('待っています');
  const beforeRelease = await page.evaluate(() => (window as unknown as { __workerEvents: { action: string; name: string }[] }).__workerEvents);
  expect(beforeRelease.some(event => event.action === 'create' && event.name === 'image-converter-oxipng')).toBe(false);
  let releaseOxipng!: () => void;
  const blockedOxipng = new Promise<void>(resolve => { releaseOxipng = resolve; });
  const oxipngWasm = '**/assets/squoosh_oxipng_bg-*.wasm';
  await page.route(oxipngWasm, async route => { await blockedOxipng; await route.continue(); }, { times: 1 });
  const oxipngRequest = page.waitForRequest(oxipngWasm);
  release();
  try {
    await expect(page.locator('.image-panel[data-side="left"] .image-avif-status')).toContainText('完了', { timeout: 60000 });
    await oxipngRequest;
    await page.getByLabel('左の出力形式').selectOption('image/webp');
    await expect(page.locator('.image-panel[data-side=left] .image-webp-status')).toContainText('待っています');
    const waiting = await page.evaluate(() => (window as unknown as { __workerEvents: { action: string; name: string }[] }).__workerEvents);
    expect(waiting.some(event => event.action === 'create' && event.name === 'image-converter-webp')).toBe(false);
  } finally {
    releaseOxipng();
  }
  await expect(oxipngStatus).toContainText('完了', { timeout: 60000 });
  await expect(page.locator('.image-panel[data-side=left] .image-webp-status')).toContainText('完了');
  await page.clock.runFor(800);
  await expect(page.locator('.image-evaluation-status')).toContainText('完了', { timeout: 60000 });
  const events = await page.evaluate(() => (window as unknown as { __workerEvents: { action: string; name: string; at: number }[] }).__workerEvents);
  const avifStart = events.findIndex(event => event.action === 'create' && event.name === 'image-converter-avif');
  const avifEnd = events.findIndex(event => event.action === 'terminate' && event.name === 'image-converter-avif');
  const oxipngStart = events.findIndex(event => event.action === 'create' && event.name === 'image-converter-oxipng');
  const oxipngEnd = events.findIndex(event => event.action === 'terminate' && event.name === 'image-converter-oxipng');
  const webpStart = events.findIndex(event => event.action === 'create' && event.name === 'image-converter-webp');
  const webpEnd = events.findIndex(event => event.action === 'terminate' && event.name === 'image-converter-webp');
  const qualityAfterWebp = events.findIndex((event, index) => index > webpEnd && event.action === 'create' && event.name === 'image-quality-ssimulacra2');
  expect(avifStart).toBeGreaterThanOrEqual(0);
  expect(avifEnd).toBeGreaterThan(avifStart);
  expect(oxipngStart).toBeGreaterThan(avifEnd);
  expect(oxipngEnd).toBeGreaterThan(oxipngStart);
  expect(webpStart).toBeGreaterThan(oxipngEnd);
  expect(webpEnd).toBeGreaterThan(webpStart);
  expect(qualityAfterWebp).toBeGreaterThan(webpEnd);
});

test('4種類のサンプルを選び、元データとJPEG・PNG変換結果を保存する', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  const sampleSection = page.locator('.image-samples');
  await sampleSection.evaluate(element => {
    (window as Window & { sampleNodesBefore?: Element[] }).sampleNodesBefore = [...element.querySelectorAll('.image-sample')];
  });
  await expect(sampleSection).toHaveCount(1);
  await expect(sampleSection).toBeVisible();
  expect(await page.locator('.image-sample-list').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(4);
  await expect(page.locator('.image-drop')).toHaveCount(1);
  expect(await sampleSection.evaluate(element => element.compareDocumentPosition(document.querySelector('.image-drop')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  const samples = [
    { name: 'レッサーパンダ・写真、3840 × 2560 px、JPEG、3.87 MB', filename: 'red-panda.jpg', dimensions: '3840 × 2560 px' },
    { name: '輪郭イラスト、1200 × 900 px、PNG、70.22 KB', filename: 'outline.png', dimensions: '1200 × 900 px' },
    { name: '架空のスマートフォン画面、900 × 1600 px、PNG、80.82 KB', filename: 'mobile-screen.png', dimensions: '900 × 1600 px' },
    { name: '透明な幾何学、1200 × 900 px、PNG、542.94 KB', filename: 'geometry.png', dimensions: '1200 × 900 px' },
  ];
  const thumbs = page.locator('.image-sample img');
  await expect(thumbs).toHaveCount(4);
  await expect(thumbs.nth(0)).toHaveAttribute('src', /\/web-toolbox\/samples\/red-panda-thumb\.jpg$/);
  for (const [index, sample] of samples.entries()) {
    const sampleButton = page.getByRole('button', { name: sample.name, exact: true });
    if (index === 0) {
      await sampleButton.focus();
      await sampleButton.press('Enter');
    } else {
      await sampleButton.click();
    }
    await expect(page.locator('.image-info')).toContainText(`${sample.filename} ${sample.dimensions}`);
    await expect(sampleButton).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('.image-sample[aria-pressed="true"]')).toHaveCount(1);
    if (index === 0) {
      await expect(sampleButton).toBeFocused();
      const previewBounds = (await page.locator('.image-stage').boundingBox())!;
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      expect(previewBounds.y).toBeGreaterThanOrEqual(0);
      expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(viewportHeight);
    }
    expect(await sampleSection.evaluate(element => [...element.querySelectorAll('.image-sample')].every((button, position) => button === (window as typeof window & { sampleNodesBefore?: Element[] }).sampleNodesBefore?.[position]))).toBe(true);
    const saved = await saveImage(page, page.getByRole('button', { name: '左をダウンロード' }), sample.filename);
    expect(saved).toEqual(await readFile(`public/samples/${sample.filename}`));
    if (index === 0) {
      const converted = await saveImage(page, page.getByRole('button', { name: '右をダウンロード' }), 'red-panda-right-q0.75.jpg');
      const dimensions = await page.evaluate(async base64 => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${base64}`;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, converted.toString('base64'));
      expect(dimensions).toEqual([3840, 2560]);
    }
  }

  await page.getByRole('button', { name: /輪郭イラスト/ }).click();
  await expect(page.locator('.image-info')).toContainText('outline.png 1200 × 900 px');
  const leftSave = page.getByRole('button', { name: '左をダウンロード' });
  const rightSave = page.getByRole('button', { name: '右をダウンロード' });
  const rightFormat = page.getByLabel('右の出力形式');
  await rightFormat.selectOption('image/jpeg');
  const jpeg = await saveImage(page, rightSave, 'outline-right-q0.75.jpg');
  expect([...jpeg.subarray(0, 3)]).toEqual([255, 216, 255]);
  await rightFormat.selectOption('image/png');
  const png = await saveImage(page, rightSave, 'outline-right.png');
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await expect(leftSave).toBeEnabled();
});

test('ズーム・パンを画像の固定倍率で行い、比較位置と変換状態を保つ', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  let workerCount = 0;
  page.on('worker', () => workerCount++);
  await page.locator('[type=file]').setInputFiles(await testImage(page, 800, 600));
  const stage = page.locator('.image-stage');
  const preview = page.getByAltText('右側のプレビュー');
  const original = page.getByRole('img', { name: '元画像のプレビュー' });
  const minus = page.getByRole('button', { name: '縮小' });
  const plus = page.getByRole('button', { name: '拡大' });
  const reset = page.getByRole('button', { name: /表示倍率を100%に戻す/ });
  const split = page.getByRole('slider', { name: '比較位置' });
  await expect(preview).toBeVisible();
  await expect(original).toBeVisible();
  const initialUrl = await preview.getAttribute('src');
  const initialGeometry = await stage.evaluate(element => {
    const stageRect = element.getBoundingClientRect();
    const canvas = element.querySelector('canvas')!.getBoundingClientRect();
    const image = element.querySelector('img[data-side="right"]')!.getBoundingClientRect();
    return {
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      image: { x: image.x, y: image.y, width: image.width, height: image.height },
      stage: { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height },
    };
  });
  expect(initialGeometry.canvas.width).toBe(800);
  expect(initialGeometry.canvas.height).toBe(600);
  expect(initialGeometry.image).toEqual(initialGeometry.canvas);
  expect(initialGeometry.canvas.x + 400).toBeCloseTo(initialGeometry.stage.x + initialGeometry.stage.width / 2, 0);
  expect(initialGeometry.canvas.y + 300).toBeCloseTo(initialGeometry.stage.y + initialGeometry.stage.height / 2, 0);

  await split.focus();
  for (let index = 0; index < 15; index++) await split.press('ArrowRight');
  await plus.click();
  await expect(reset).toHaveText('125%');
  let geometry = await preview.boundingBox();
  expect(geometry!.width).toBe(1000);
  expect(geometry!.height).toBeCloseTo(750, 2);
  const dividerBeforePan = await stage.locator('.image-divider').boundingBox();
  await plus.click();
  await plus.click();
  await expect(reset).toHaveText('175%');
  await expect(split).toHaveAttribute('aria-valuenow', '65');
  await expect(plus).toBeEnabled();
  await expect(minus).toBeEnabled();
  const fixedClip = await stage.evaluate(element => {
    const stageRect = element.getBoundingClientRect();
    const left = element.querySelector('.image-layer[data-side="left"]')!;
    const right = element.querySelector('.image-layer[data-side="right"]')!;
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return {
      leftClip: getComputedStyle(left).clipPath,
      rightClip: getComputedStyle(right).clipPath,
      aligned: leftRect.x === stageRect.x + 1 && rightRect.x === stageRect.x + 1 &&
        leftRect.width === stageRect.width - 2 && rightRect.width === stageRect.width - 2,
    };
  });
  expect(fixedClip.leftClip).toContain('35%');
  expect(fixedClip.rightClip).toContain('65%');
  expect(fixedClip.aligned).toBe(true);
  await stage.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 80, bounds.y + bounds.height / 2 - 50);
  await page.mouse.up();
  const moved = await preview.boundingBox();
  expect(moved!.x).toBeLessThan(initialGeometry.image.x);
  expect(moved!.y).toBeLessThan(initialGeometry.image.y);
  const dividerAfterPan = await stage.locator('.image-divider').boundingBox();
  expect(dividerAfterPan!.x).toBeCloseTo(dividerBeforePan!.x, 0);
  await expect(preview).toHaveAttribute('src', initialUrl!);

  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touchBounds = (await stage.boundingBox())!;
    const x = touchBounds.x + touchBounds.width / 2;
    const y = touchBounds.y + touchBounds.height / 2;
    const beforeTouch = await preview.boundingBox();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30, y: y - 25, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterTouch = await preview.boundingBox();
    expect(afterTouch!.x).toBeLessThan(beforeTouch!.x);
    expect(afterTouch!.y).toBeLessThan(beforeTouch!.y);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
  }

  await stage.scrollIntoViewIfNeeded();
  const resizeBounds = (await stage.boundingBox())!;
  await page.mouse.move(resizeBounds.x + resizeBounds.width * 0.25, resizeBounds.y + resizeBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBounds.x + 1, resizeBounds.y + 1);
  await page.mouse.up();
  const viewBeforeResize = await stage.evaluate(element => ({ x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y') }));
  expect(Number.parseFloat(viewBeforeResize.x)).toBeLessThan(0);
  expect(Number.parseFloat(viewBeforeResize.y)).toBeLessThan(0);
  await page.setViewportSize({ width: 2560, height: 1800 });
  await expect.poll(() => stage.evaluate(element => ({
    x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y'),
  }))).not.toEqual(viewBeforeResize);
  const clamped = await stage.evaluate(element => {
    const width = Number.parseFloat(element.style.getPropertyValue('--image-width'));
    const height = Number.parseFloat(element.style.getPropertyValue('--image-height'));
    const zoom = Number.parseFloat(element.style.getPropertyValue('--zoom'));
    return {
      x: Number.parseFloat(element.style.getPropertyValue('--pan-x')),
      y: Number.parseFloat(element.style.getPropertyValue('--pan-y')),
      maxX: Math.max(0, (width * zoom - element.clientWidth) / 2),
      maxY: Math.max(0, (height * zoom - element.clientHeight) / 2),
    };
  });
  expect(clamped.x).toBeCloseTo(-clamped.maxX, 0);
  expect(clamped.y).toBeCloseTo(-clamped.maxY, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(preview).toBeVisible();
  await stage.scrollIntoViewIfNeeded();
  const currentBounds = (await stage.boundingBox())!;
  await page.mouse.move(currentBounds.x + currentBounds.width / 2, currentBounds.y + currentBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(currentBounds.x + currentBounds.width / 2 - 60, currentBounds.y + currentBounds.height / 2 - 30);
  await page.mouse.up();
  const panBeforeSettings = await stage.evaluate(element => ({ x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y') }));
  await page.getByLabel('左の出力形式').selectOption('image/jpeg');
  const leftQuality = page.getByRole('slider', { name: '左のJPEG品質' });
  await leftQuality.fill('0.40');
  await expect(reset).toHaveText('175%');
  expect(await stage.evaluate(element => ({ x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y') }))).toEqual(panBeforeSettings);
  await expect(preview).toHaveAttribute('src', initialUrl!);
  expect(workerCount).toBe(0);

  await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  await expect(page.locator('.image-input-error')).toContainText('読み込めません');
  await expect(reset).toHaveText('175%');
  await expect(split).toHaveAttribute('aria-valuenow', '65');
  expect(await preview.getAttribute('src')).toBe(initialUrl);

  await page.locator('[type=file]').setInputFiles(await testImage(page, 64, 32));
  await expect(reset).toHaveText('100%');
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await expect(preview).toBeVisible();
  await expect(preview).not.toHaveAttribute('src', initialUrl!);
  geometry = await preview.boundingBox();
  expect(geometry!.width).toBe(64);
  expect(geometry!.height).toBe(32);
  await stage.focus();
  await stage.press('ArrowRight');
  await expect(stage).toHaveCSS('--pan-x', '0px');
  for (let index = 0; index < 3; index++) await minus.click();
  await expect(reset).toHaveText('25%');
  await expect(minus).toBeDisabled();
  for (let index = 0; index < 15; index++) await plus.click();
  await expect(reset).toHaveText('400%');
  await expect(plus).toBeDisabled();
});

test('倍率操作はプレビュー直下に右寄せし、狭い画面と両テーマで収まる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  await page.locator('[type=file]').setInputFiles(await testImage(page));

  const tools = page.getByRole('group', { name: '表示倍率' });
  const reset = page.getByRole('button', { name: /表示倍率を100%に戻す/ });
  const plus = page.getByRole('button', { name: '拡大' });

  for (const [width, scheme] of [
    [1280, 'light'],
    [1280, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);

    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.image-stage')!;
      const tools = document.querySelector('.image-view-tools')!;
      const settings = document.querySelector('.image-controls')!;
      const rect = (element: Element) => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      const buttons = [...tools.querySelectorAll('button')].map(rect);
      return {
        adjacent: stage.nextElementSibling === tools,
        stage: rect(stage),
        tools: rect(tools),
        settings: rect(settings),
        buttons,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.adjacent).toBe(true);
    expect(layout.tools.y).toBeGreaterThanOrEqual(layout.stage.bottom);
    expect(layout.tools.right).toBeCloseTo(layout.stage.right, 0);
    expect(layout.settings.y).toBeGreaterThanOrEqual(layout.tools.bottom);
    expect(layout.scrollWidth).toBeLessThanOrEqual(width);
    for (let index = 1; index < layout.buttons.length; index++) {
      expect(layout.buttons[index - 1]!.right).toBeLessThanOrEqual(layout.buttons[index]!.x);
    }

    await expect(tools).toBeVisible();
    await reset.focus();
    await page.keyboard.press('Tab');
    await expect(plus).toBeFocused();
    expect(await plus.evaluate(button => getComputedStyle(button).outlineStyle)).not.toBe('none');
    await plus.press('Enter');
    await expect(reset).toHaveText('125%');
    await reset.press('Enter');
    await expect(reset).toHaveText('100%');
  }
});

test('画像選択エリアは画面高に追従し、文言を中央に収める', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const drop = page.locator('.image-drop');

  for (const [width, height, expected] of [
    [1280, 600, 252],
    [1280, 900, 378],
    [320, 720, 216],
  ] as const) {
    await page.setViewportSize({ width, height });
    const bounds = (await drop.boundingBox())!;
    expect(bounds.height).toBeCloseTo(expected, 0);
    const textBounds = await drop.locator('strong, span').evaluateAll(elements =>
      elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    for (const text of textBounds) {
      expect(text.x).toBeGreaterThanOrEqual(bounds.x);
      expect(text.x + text.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(text.y).toBeGreaterThanOrEqual(bounds.y);
      expect(text.y + text.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(text.x + text.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('サンプルカードは実幅に応じて列数を調整し、320〜1280pxの両テーマで収まる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const expectedColumns = new Map([[320, 2], [768, 2], [900, 2], [1024, 3], [1280, 4]]);

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    for (const [width, columns] of expectedColumns) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.locator('.image-samples').evaluate(section => {
        const list = section.querySelector<HTMLElement>('.image-sample-list')!;
        const cards = [...list.querySelectorAll<HTMLButtonElement>('.image-sample')];
        const rect = (element: Element) => {
          const { left, right, top, bottom } = element.getBoundingClientRect();
          return { left, right, top, bottom };
        };
        const cardRects = cards.map(rect);
        const contentRects = cards.map(card => [...card.querySelectorAll('img, strong, span')]
          .filter(child => getComputedStyle(child).display !== 'none')
          .map(rect));
        return {
          columns: new Set(cardRects.map(card => card.left)).size,
          cardRects,
          contentRects,
          titleWidths: cards.map(card => card.querySelector('strong')!.getBoundingClientRect().width),
          detailsVisible: getComputedStyle(cards[0]!.querySelector(':scope > span:not(.image-sample-thumbnail)')!).display !== 'none',
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        };
      });

      expect(layout.columns, `${width}px ${scheme}`).toBe(columns);
      expect(layout.scrollWidth, `${width}px ${scheme}`).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.detailsVisible, `${width}px ${scheme}`).toBe(true);
      expect(Math.min(...layout.titleWidths), `${width}px ${scheme} title width`).toBeGreaterThanOrEqual(width > 759 ? 64 : 32);
      for (const [index, card] of layout.cardRects.entries()) {
        for (const child of layout.contentRects[index]!) {
          expect(child.left, `${width}px ${scheme} card ${index}`).toBeGreaterThanOrEqual(card.left);
          expect(child.right, `${width}px ${scheme} card ${index}`).toBeLessThanOrEqual(card.right);
        }
        for (const other of layout.cardRects.slice(index + 1)) {
          const overlapsHorizontally = card.left < other.right && card.right > other.left;
          const overlapsVertically = card.top < other.bottom && card.bottom > other.top;
          expect(overlapsHorizontally && overlapsVertically, `${width}px ${scheme} cards overlap`).toBe(false);
        }
      }
    }
  }
});

test('サムネイルの待機・成功・失敗表示はカード寸法を保ち、選択を妨げない', async ({ page }) => {
  let releaseSuccess!: () => void;
  const successGate = new Promise<void>(resolve => { releaseSuccess = resolve; });
  await page.route('**/samples/*-thumb.*', async route => {
    const url = route.request().url();
    if (url.endsWith('/outline-thumb.png')) {
      await successGate;
      await route.fulfill({ path: 'public/samples/outline-thumb.png' });
    } else if (url.endsWith('/mobile-screen-thumb.png')) {
      await route.abort();
    } else {
      await route.continue();
    }
  });
  await page.setViewportSize({ width: 320, height: 1800 });
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./?tool=image-converter');
  const outlineButton = page.getByRole('button', { name: /輪郭イラスト/ });
  const outlineFrame = outlineButton.locator('.image-sample-thumbnail');
  const outlineImage = outlineFrame.locator('img');
  await outlineImage.scrollIntoViewIfNeeded();
  await expect(outlineFrame).toHaveAttribute('data-state', 'loading');
  await expect(outlineFrame.locator('svg').first()).toBeVisible();
  await expect(outlineImage).toHaveCSS('visibility', 'hidden');
  const loadingLayout = await Promise.all([outlineButton.boundingBox(), outlineFrame.boundingBox()]);
  expect(loadingLayout.every(Boolean)).toBe(true);
  expect(loadingLayout[1]!.width).toBe(32);
  expect(loadingLayout[1]!.height).toBe(32);

  const mobileError = page.locator('[data-sample="mobile-screen"] .image-sample-thumbnail');
  await expect(mobileError).toHaveAttribute('data-state', 'error');
  await expect(mobileError.locator('svg').nth(1)).toBeVisible();
  await expect(mobileError.locator('img')).toHaveCSS('visibility', 'hidden');

  await outlineButton.click();
  await expect(page.locator('.image-info')).toContainText('outline.png');
  releaseSuccess();
  await expect(outlineFrame).toHaveAttribute('data-state', 'ready');
  await expect(outlineImage).toHaveCSS('visibility', 'visible');
  expect(await Promise.all([outlineButton.boundingBox(), outlineFrame.boundingBox()])).toEqual(loadingLayout);

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  const desktopFrame = await outlineFrame.boundingBox();
  expect(desktopFrame!.width).toBe(64);
  expect(desktopFrame!.height).toBe(64);
  await expect(outlineButton).toHaveAttribute('aria-pressed', 'true');
});

test('比較・変換カードは320・768・1280pxの両テーマで重ならず、プレビューを保つ', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.getByRole('checkbox', { name: '画質の自動評価' }).uncheck();
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  await expect(page.locator('.image-stage canvas')).toBeVisible();

  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    for (const width of [320, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const layout = await page.locator('.image-tool').evaluate(root => {
        const rect = (element: Element) => {
          const bounds = element.getBoundingClientRect();
          return { left: bounds.left, right: bounds.right, top: bounds.top, bottom: bounds.bottom, width: bounds.width, height: bounds.height };
        };
        const panels = [...root.querySelectorAll<HTMLElement>('.image-panel')];
        const stage = root.querySelector<HTMLElement>('.image-stage')!;
        const zoom = root.querySelector<HTMLElement>('.image-view-tools')!;
        const content = panels.map(panel => [...panel.querySelectorAll<HTMLElement>('.image-result, .image-score, .image-save')].map(rect));
        return {
          panels: panels.map(rect), content,
          stage: rect(stage), zoom: rect(zoom),
          scrollWidth: document.documentElement.scrollWidth,
          viewportWidth: innerWidth,
        };
      });
      expect(layout.scrollWidth, `${width}px ${scheme} document`).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.zoom.top, `${width}px ${scheme} zoom position`).toBeGreaterThanOrEqual(layout.stage.bottom);
      expect(layout.stage.height, `${width}px ${scheme} preview cap`).toBeLessThanOrEqual(900 * .65 + 2);
      expect(layout.stage.height, `${width}px ${scheme} preview ratio`).toBeGreaterThanOrEqual(layout.stage.width * .5 - 2);
      for (const [index, panel] of layout.panels.entries()) {
        expect(panel.width, `${width}px ${scheme} panel`).toBeGreaterThan(0);
        for (const item of layout.content[index]!) {
          expect(item.left, `${width}px ${scheme} content left`).toBeGreaterThanOrEqual(panel.left);
          expect(item.right, `${width}px ${scheme} content right`).toBeLessThanOrEqual(panel.right);
        }
        for (const other of layout.panels.slice(index + 1)) {
          const horizontalOverlap = panel.left < other.right && panel.right > other.left;
          const verticalOverlap = panel.top < other.bottom && panel.bottom > other.top;
          expect(horizontalOverlap && verticalOverlap, `${width}px ${scheme} panels overlap`).toBe(false);
        }
      }
    }
  }
});

test('320pxの両テーマでドロップ後も失敗した置換から復帰できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const scheme of ['dark', 'light'] as const) {
    await page.goto('./?tool=image-converter');
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const initial = page.locator('.image-drop');
    const initialBounds = (await initial.boundingBox())!;
    const samplesBefore = (await page.locator('.image-samples').boundingBox())!;
    const sampleButtons = page.locator('.image-sample');
    const sampleBounds = await sampleButtons.evaluateAll(buttons => buttons.map(button => {
      const { x, y } = button.getBoundingClientRect();
      return { x, y };
    }));
    expect(await page.locator('.image-sample-list').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    expect(await sampleButtons.nth(0).getAttribute('aria-label')).toContain('3840 × 2560 px、JPEG、3.87 MB');
    expect(await sampleButtons.nth(0).locator(':scope > span:not(.image-sample-thumbnail)').evaluate(element => getComputedStyle(element).display)).toBe('block');
    expect(sampleBounds[0]!.y).toBe(sampleBounds[1]!.y);
    expect(sampleBounds[2]!.y).toBe(sampleBounds[3]!.y);
    expect(sampleBounds[0]!.y).toBeLessThan(sampleBounds[2]!.y);
    expect(samplesBefore.y + samplesBefore.height).toBeLessThan(initialBounds.y);
    expect(initialBounds.height).toBe(216);
    await initial.evaluate(async button => {
      const canvas = document.createElement('canvas');
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp'));
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([blob], 'drop.webp', { type: blob.type }));
      button.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
    });
    const saveLeft = page.getByRole('button', { name: '左をダウンロード' });
    const saveRight = page.getByRole('button', { name: '右をダウンロード' });
    await expect(saveLeft).toBeEnabled();
    await expect(saveRight).toBeEnabled();
    await expect(initial).toBeHidden();
    const samplesAfter = (await page.locator('.image-samples').boundingBox())!;
    const comparisonBounds = (await page.locator('.image-comparison-area').boundingBox())!;
    expect(samplesAfter.y).toBeCloseTo(samplesBefore.y, 0);
    expect(samplesAfter.height).toBeCloseTo(samplesBefore.height, 0);
    expect(comparisonBounds.y).toBeGreaterThanOrEqual(samplesAfter.y + samplesAfter.height);
    expect(comparisonBounds.width).toBeCloseTo(initialBounds.width, 0);
    await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    const inputError = page.locator('.image-input-error');
    await expect(inputError).toHaveAttribute('role', 'alert');
    await expect(inputError).toContainText('読み込めません');
    await expect(page.locator('.image-tool > section[aria-label="画像の比較と変換設定"]')).toBeVisible();
    await expect(saveLeft).toBeEnabled();
    await expect(page.locator('.image-info')).toContainText('drop.webp');
    const left = (await page.getByRole('group', { name: '左の設定' }).boundingBox())!;
    const right = (await page.getByRole('group', { name: '右の設定' }).boundingBox())!;
    expect(left.y + left.height).toBeLessThan(right.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const recovery = await testImage(page);
    await page.locator('[type=file]').setInputFiles(recovery);
    await expect(page.locator('.image-info')).toContainText(recovery.name);
    await expect(inputError).toBeEmpty();
  }
});

test('比較画像エリアへのドロップと画像変更ボタンで置き換え、同じファイルを再選択できる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  const replacement = await testImage(page, 32, 16);
  const initial = page.getByRole('button', { name: /画像を選択/ });
  await expect(initial).toBeVisible();
  expect((await initial.boundingBox())!.height).toBeCloseTo(302.4, 0);
  // Keep interception enabled across consecutive dialogs, including on Firefox.
  const choosers: FileChooser[] = [];
  page.on('filechooser', chooser => choosers.push(chooser));
  await initial.press('Enter');
  await expect.poll(() => choosers.length).toBe(1);
  await choosers[0]!.setFiles(image);
  const comparison = page.locator('.image-comparison-area');
  const info = page.locator('.image-info');
  const rightPreview = page.getByAltText('右側のプレビュー');
  await expect(info).toContainText(image.name);

  const drag = await comparison.evaluate((area, bytes) => {
    const slider = area.querySelector('.image-divider')!;
    const file = new File([Uint8Array.from(bytes)], 'replacement.png', { type: 'image/png' });
    const files = new DataTransfer();
    files.items.add(file);
    const text = new DataTransfer();
    text.setData('text/plain', 'テキスト');
    const dispatch = (target: Element, type: string, dataTransfer: DataTransfer) =>
      !target.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
    const highlighted = () => area.classList.contains('is-over');
    const textPrevented = ['dragenter', 'dragover', 'drop'].map(type => dispatch(slider, type, text));
    dispatch(area, 'dragenter', files);
    const highlightedOnEnter = highlighted();
    dispatch(slider, 'dragenter', files);
    dispatch(area, 'dragleave', files);
    const highlightedOnChild = highlighted();
    dispatch(slider, 'dragleave', files);
    const highlightedOnLeave = highlighted();
    dispatch(slider, 'dragenter', files);
    const fileOverPrevented = dispatch(slider, 'dragover', files);
    const fileDropPrevented = dispatch(slider, 'drop', files);
    return { textPrevented, highlightedOnEnter, highlightedOnChild, highlightedOnLeave, fileOverPrevented,
      fileDropPrevented, highlightedAfterDrop: highlighted() };
  }, [...replacement.buffer]);
  expect(drag).toEqual({
    textPrevented: [false, false, false],
    highlightedOnEnter: true,
    highlightedOnChild: true,
    highlightedOnLeave: false,
    fileOverPrevented: true,
    fileDropPrevented: true,
    highlightedAfterDrop: false,
  });
  await expect(info).toContainText('replacement.png');
  await expect(info).toContainText('32 × 16 px');
  await expect(rightPreview).toBeVisible();
  const change = page.getByRole('button', { name: '画像を変更' });
  for (let attempt = 0; attempt < 2; attempt++) {
    const previousUrl = await rightPreview.getAttribute('src');
    await change.click();
    await expect.poll(() => choosers.length).toBe(attempt + 2);
    await choosers[attempt + 1]!.setFiles(image);
    await expect(page.locator('[type=file]')).toHaveValue('');
    await expect(info).toContainText(image.name);
    await expect(info).toContainText('64 × 32 px');
    await expect(rightPreview).not.toHaveAttribute('src', previousUrl!);
    await expect(rightPreview).toBeVisible();
  }
  await expect(initial).toBeHidden();
  await expect(comparison).toBeVisible();
});

test('変換に失敗した側を通知し、反対側は個別に保存・復旧できる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
  });
  await page.locator('[type=file]').setInputFiles(image);
  const left = page.getByRole('group', { name: '左の設定' });
  const right = page.getByRole('group', { name: '右の設定' });
  await expect(right.getByRole('alert')).toContainText('右側：指定形式に変換できませんでした');
  await expect(right.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('status')).toBeEmpty();
  expect(await saveImage(page, left.getByRole('button'), image.name)).toEqual(image.buffer);
  await expect(left.getByRole('status')).toHaveText(/0% 元 /);

  await left.getByLabel('左の出力形式').selectOption('image/png');
  await expect(left.getByRole('alert')).toContainText('左側：指定形式に変換できませんでした');
  await expect(left.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('alert')).toContainText('指定形式に変換できませんでした');
  await expect(right.getByRole('button')).toBeDisabled();
  await expect(left.getByRole('status')).toBeEmpty();
  await right.getByLabel('右の出力形式').selectOption('original');
  await expect(right.getByRole('alert')).toBeEmpty();
  await expect(left.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('button')).toBeEnabled();
  await expect(right.getByRole('status')).toHaveText(/0% 元 /);
});

test.describe('タッチ操作', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 720 } });

  test('比較位置をタップしても再変換しない', async ({ page }) => {
    await page.goto('./?tool=image-converter');
    await page.locator('[type=file]').setInputFiles(await testImage(page));
    const preview = page.getByAltText('右側のプレビュー');
    await expect(preview).toBeVisible();
    const url = await preview.getAttribute('src');
    const split = page.getByRole('slider', { name: '比較位置' });
    await split.scrollIntoViewIfNeeded();
    const bounds = (await split.boundingBox())!;
    await expect(split).toHaveAttribute('aria-valuenow', '50');
    expect(await split.evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
    await page.touchscreen.tap(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
    expect(Number(await split.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
    expect(Number(await split.getAttribute('aria-valuenow'))).toBeLessThan(60);
    await expect(preview).toHaveAttribute('src', url!);
  });
});

test('320×720でも比較バーを画面内からステージ外へドラッグできる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  const split = page.getByRole('slider', { name: '比較位置' });
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await dragDividerOutsideStage(page, split);
  await expect(split).toHaveAttribute('aria-valuenow', '0');
});

test('元画像とHTML Canvasが作った左右のJPEGをWasmで評価し、変更した側だけ失効する', async ({ page, baseURL }) => {
  const url = new URL(baseURL!);
  const external: string[] = [];
  await page.context().route(/^https?:/, route => {
    const request = route.request();
    if (new URL(request.url()).origin === url.origin && request.method() === 'GET' && !request.postData()) {
      return route.continue();
    }
    external.push(request.url());
    return route.abort();
  });
  await page.addInitScript(() => {
    const encodings = new WeakMap<Blob, Uint8ClampedArray>();
    const checks: { referenceMatches: boolean; decodesMatch: Promise<boolean> }[] = [];
    Object.assign(window, { imageQualityChecks: checks });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== 'image/jpeg') return toBlob.call(this, callback, type, quality);
      const sourcePixels = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data;
      return toBlob.call(this, blob => {
        if (blob) encodings.set(blob, sourcePixels);
        callback(blob);
      }, type, quality);
    };

    function read(image: ImageBitmap, canvas: HTMLCanvasElement | OffscreenCanvas) {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, image.width, image.height);
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    }
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown) {
      const { reference, images } = message as { reference: ImageBitmap; images: Blob[] };
      const { width, height } = reference;
      const normalizer = new OffscreenCanvas(width, height);
      const original = read(reference, normalizer);
      checks.push({
        referenceMatches: images.every(blob => encodings.get(blob)?.every((byte, i) => byte === original[i])),
        decodesMatch: Promise.all(images.map(async blob => {
          const image = await createImageBitmap(blob);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const html = read(image, canvas);
            const offscreen = read(image, new OffscreenCanvas(width, height));
            return html.every((byte, i) => byte === offscreen[i]) && html.some((byte, i) => byte !== original[i]);
          } finally {
            image.close();
          }
        })).then(values => values.every(Boolean)),
      });
      Reflect.apply(post, this, arguments);
    };
  });

  await page.goto('./?tool=image-converter');
  const jpegScore = /^-?\d+\.\d$/;
  const button = page.getByRole('button', { name: '画質を評価', exact: true });
  const left = page.locator('.image-panel[data-side=left] .image-score');
  const right = page.locator('.image-panel[data-side=right] .image-score');
  const status = page.locator('.image-evaluation-status');
  const input = await testImage(page);
  await page.getByRole('checkbox', { name: '画質の自動評価' }).uncheck();
  await page.locator('[type=file]').setInputFiles(input);
  await expect(left).toHaveText('基準画像');
  await page.getByLabel('左の出力形式').selectOption('image/jpeg');
  await page.getByLabel('左のJPEG品質').fill('0.25');
  await expect(button).toBeEnabled();
  const wasmLoaded = page.waitForResponse(response => /\/web-toolbox\/assets\/ssimulacra2-0\.1\.0-[\w-]+\.wasm$/.test(response.url()));
  const workerStarted = page.waitForEvent('worker');
  await button.click();
  const worker = await workerStarted;
  expect(new URL(worker.url()).pathname).toMatch(/^\/web-toolbox\/assets\//);
  const wasm = await wasmLoaded;
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()['content-type']).toContain('application/wasm');
  await expect(status).toContainText('完了');
  await expect(left).toHaveText(jpegScore);
  await expect(right).toHaveText(jpegScore);
  expect(Number(await right.textContent())).toBeLessThan(100);
  const checks = await page.evaluate(async () => {
    const state = window as Window & { imageQualityChecks?: { referenceMatches: boolean; decodesMatch: Promise<boolean> }[] };
    return Promise.all((state.imageQualityChecks ?? []).map(async item => [item.referenceMatches, await item.decodesMatch]));
  });
  expect(checks).toEqual([[true, true]]);
  const rightScore = await right.textContent();

  await page.getByLabel('左のJPEG品質').fill('0.90');
  await expect(left).not.toHaveText(jpegScore);
  await expect(right).toHaveText(rightScore!);
  await expect(button).toBeEnabled();
  await expect(left).toHaveText('画質は未評価');
  await page.getByLabel('左の出力形式').selectOption('image/png');
  await expect(left).toHaveText('画質評価は未対応');
  await expect(page.getByRole('button', { name: '左をダウンロード' })).toBeEnabled();
  expect(external).toEqual([]);
});

test('初回と品質変更後に自動評価し、連続操作では最後の出力だけを採点する', async ({ page }) => {
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const auto = page.getByRole('checkbox', { name: '画質の自動評価' });
  const score = page.locator('.image-panel[data-side=right] .image-score');
  const quality = page.getByRole('slider', { name: '右のJPEG品質' });
  const status = page.locator('.image-evaluation-status');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  const jpegScore = /^-?\d+\.\d$/;
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  await expect(auto).toBeChecked();
  await expect(save).toBeEnabled();
  await expect(status).toContainText('待機');
  await page.clock.runFor(800);
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(jpegScore);
  const initialScore = await score.textContent();
  expect(workers).toHaveLength(1);

  await quality.fill('0.45');
  await expect(score).not.toHaveText(jpegScore);
  await page.clock.runFor(150);
  await quality.fill('0.15');
  await page.clock.runFor(150);
  await quality.fill('0.01');
  await page.clock.runFor(180);
  await expect(save).toBeEnabled();
  await expect(score).toHaveText('評価待機中…');
  await page.clock.runFor(619);
  expect(workers).toHaveLength(1);
  await page.clock.runFor(1);
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(jpegScore);
  await expect(score).not.toHaveText(initialScore!);
  expect(workers).toHaveLength(2);

  await auto.press('Space');
  await expect(auto).not.toBeChecked();
  await quality.fill('0.60');
  await page.clock.runFor(1600);
  await expect(save).toBeEnabled();
  await expect(score).toHaveText('画質は未評価');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  await expect(auto).not.toBeChecked();
  await expect(save).toBeEnabled();
  await page.clock.runFor(800);
  expect(workers).toHaveLength(2);
  await expect.poll(() => page.workers().length).toBe(0);

  await auto.check();
  await page.clock.runFor(800);
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(jpegScore);
  expect(workers).toHaveLength(3);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('2048×2048のJPEGを実Wasmで自動評価する', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?tool=image-converter');
  const wasmLoaded = page.waitForResponse('**/web-toolbox/assets/ssimulacra2-0.1.0-*.wasm');
  await page.locator('[type=file]').setInputFiles(await testImage(page, 2048, 2048));
  await expect(page.locator('.image-info')).toContainText('2048 × 2048 px');
  await expect(page.locator('.image-evaluation-limit')).toBeEmpty();
  expect((await wasmLoaded).ok()).toBe(true);
  await expect(page.locator('.image-evaluation-status')).toContainText('完了', { timeout: 30_000 });
  await expect(page.locator('.image-panel[data-side=right] .image-score')).toHaveText(/^-?\d+\.\d$/);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('評価の画素数を超えてもJPEGの変換と保存が使える', async ({ page }) => {
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const image = await testImage(page, 3200, 3200);
  await page.locator('[type=file]').setInputFiles({ ...image, name: 'large.png' });
  await expect(page.locator('.image-evaluation-limit')).toContainText('10,000,000画素');
  await expect(page.locator('.image-panel[data-side=right] .image-score')).toHaveText('評価上限超過');
  await expect(page.getByRole('button', { name: '画質を評価' })).toBeDisabled();
  const jpeg = await saveImage(page, page.getByRole('button', { name: '右をダウンロード' }), 'large-right-q0.75.jpg');
  expect([...jpeg.subarray(0, 3)]).toEqual([255, 216, 255]);
  await page.clock.runFor(800);
  expect(workers).toHaveLength(0);
  expect(page.workers()).toHaveLength(0);
});

test('狭い画面と両テーマで、Wasmロード中の中止と失敗から再評価できる', async ({ page }) => {
  await pauseUiClock(page);
  await page.setViewportSize({ width: 360, height: 720 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  const start = page.getByRole('button', { name: '画質を評価' });
  const cancel = page.getByRole('button', { name: '評価を中止' });
  const auto = page.getByRole('checkbox', { name: '画質の自動評価' });
  const status = page.locator('.image-evaluation-status');
  const score = page.locator('.image-panel[data-side=right] .image-score');
  const wasm = '**/ssimulacra2-0.1.0-*.wasm';
  const scoringLockHeld = () => page.evaluate(async lockName => {
    const { held } = await navigator.locks.query();
    return held?.some(lock => lock.name === lockName) ?? false;
  }, imageWorkerLockName);
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(wasm, async route => {
    await blocked;
    await route.abort().catch(() => {});
  }, { times: 1 });
  try {
    const requested = page.waitForRequest(wasm);
    await expect(status).toContainText('待機');
    await page.clock.runFor(800);
    await requested;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(status).toContainText('評価しています');
    await expect.poll(scoringLockHeld).toBe(true);
    await cancel.click();
    await expect(status).toContainText('中止しました');
    await expect(score).toHaveText('画質は未評価');
    await expect(start).toBeEnabled();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect.poll(scoringLockHeld).toBe(false);
    await page.clock.runFor(1600);
    await expect(status).toContainText('中止しました');
    await expect(score).toHaveText('画質は未評価');
  } finally {
    release();
  }

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.route(wasm, route => route.fulfill({ status: 503 }), { times: 1 });
  await start.click();
  await expect(status).toContainText('評価できませんでした');
  await expect(score).toHaveText('評価に失敗');
  await expect(page.getByRole('button', { name: '右をダウンロード' })).toBeEnabled();
  await start.click();
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(/^-?\d+\.\d$/);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect(auto).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});

test('WebP encodes transparent odd-sized images, saves and accepts JPEG, PNG, WebP and AVIF inputs', async ({ page, browserName }) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const openTool = async () => {
    await page.goto('./?tool=image-converter');
    await page.getByLabel('画質の自動評価').uncheck();
  };
  await openTool();
  const input = page.locator('[type=file]');
  const source = { name: 'sample.png', mimeType: 'image/png', buffer: rgbaPng(127, 97) };
  await input.setInputFiles(source);
  const right = page.locator('.image-panel[data-side=right]');
  const format = page.getByLabel('右の出力形式');
  const status = right.locator('.image-webp-status');
  const preview = page.getByAltText('右側のプレビュー');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  const originalCanvas = page.locator('.image-original-layer canvas');
  const expectOriginalImage = async (filename: string) => {
    await expect(page.locator('.image-filename')).toHaveText(filename);
    await expect(originalCanvas).toHaveJSProperty('width', 127);
    await expect(originalCanvas).toHaveJSProperty('height', 97);
  };
  const originalPixels = () => page.locator('.image-original-layer canvas').evaluate(canvas => {
    const element = canvas as HTMLCanvasElement;
    return [...element.getContext('2d')!.getImageData(0, 0, element.width, element.height).data];
  });

  await expectOriginalImage('sample.png');
  const baseline = await originalPixels();
  expect(requests.some(url => /libwebp|\/assets\/worker-/.test(url))).toBe(false);
  const wasm = page.waitForResponse('**/web-toolbox/assets/libwebp-1.6.0-encoder-*.wasm');
  await format.selectOption('image/webp');
  expect((await wasm).ok()).toBe(true);
  await expect(status).toContainText('完了');
  const pixels = () => preview.evaluate(img => {
    const image = img as HTMLImageElement;
    const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
    ctx.drawImage(image, 0, 0);
    return [...ctx.getImageData(0, 0, canvas.width, canvas.height).data];
  });
  expect((await pixels()).filter((_, index) => index % 4 === 3)).toEqual(baseline.filter((_, index) => index % 4 === 3));
  const previewData = (side: string) => page.getByAltText(side + '側のプレビュー').evaluate(async img => {
    const blob = await (await fetch((img as HTMLImageElement).src)).blob();
    return { mimeType: blob.type, bytes: [...new Uint8Array(await blob.arrayBuffer())] };
  });
  const lossy = Buffer.from((await previewData('右')).bytes);
  expect(lossy.toString('ascii', 0, 4)).toBe('RIFF');
  expect(lossy.toString('ascii', 8, 12)).toBe('WEBP');
  expect(lossy.includes(Buffer.from('VP8 '))).toBe(true);

  const losslessToggle = page.getByLabel('右側のWebPを可逆圧縮にする');
  await losslessToggle.check();
  await expect(page.getByLabel('右の圧縮効率')).toHaveValue('75');
  await expect(page.getByLabel('右のWebPアルファ品質')).toBeDisabled();
  await expect(page.getByLabel('右側のWebPでSharp YUVを有効にする')).toBeDisabled();
  await expect(status).toContainText('完了');
  await expect(right.locator('.image-score')).toHaveText('可逆圧縮（スコア評価対象外）');
  await expect(preview).toHaveJSProperty('naturalWidth', 127);
  await expect(preview).toHaveJSProperty('naturalHeight', 97);
  // Browser decoding can round semi-transparent RGB differently by format.
  // Alpha and opaque RGB remain comparable even after Canvas compositing.
  const comparable = (_: number, index: number) => index % 4 === 3 || baseline[index - index % 4 + 3] === 255;
  expect((await pixels()).filter(comparable)).toEqual(baseline.filter(comparable));
  const lossless = await saveBrowserImage(page, save, 'sample-right-webp-lossless-q75-m4.webp', browserName);
  expect(lossless.toString('ascii', 12, 16)).toBe('VP8L');

  // Binary alpha avoids semi-transparent rounding and allows an exact
  // comparison of all browser-visible RGBA bytes.
  if (browserName === 'firefox') await openTool();
  await input.setInputFiles({ name: 'binary-alpha.png', mimeType: 'image/png', buffer: rgbaPng(127, 97, [0, 255]) });
  await expectOriginalImage('binary-alpha.png');
  if (browserName === 'firefox') {
    await format.selectOption('image/webp');
    await losslessToggle.check();
  }
  await expect(status).toContainText('完了');
  expect(await pixels()).toEqual(await originalPixels());

  expect((await previewData('右')).mimeType).toBe('image/webp');
  const leftFormat = page.getByLabel('左の出力形式');
  await leftFormat.selectOption('image/avif');
  await expect(page.locator('.image-panel[data-side=left] .image-avif-status')).toContainText('完了');
  const avif = await previewData('左');
  await leftFormat.selectOption('image/jpeg');
  await expect(page.getByRole('button', { name: '左をダウンロード' })).toBeEnabled();
  const jpeg = await previewData('左');
  await leftFormat.selectOption('original');
  for (const file of [
    { name: 'roundtrip.webp', mimeType: 'image/webp', buffer: lossless },
    { name: 'roundtrip.avif', mimeType: avif.mimeType, buffer: Buffer.from(avif.bytes) },
    { name: 'roundtrip.jpg', mimeType: jpeg.mimeType, buffer: Buffer.from(jpeg.bytes) },
  ]) {
    await input.setInputFiles(file);
    await expect(page.locator('.image-filename')).toHaveText(file.name);
    await expect(status).toContainText('完了');
    await expect(preview).toHaveJSProperty('naturalWidth', 127);
    await expect(preview).toHaveJSProperty('naturalHeight', 97);
  }

  await page.setViewportSize({ width: 320, height: 800 });
  for (const theme of ['light', 'dark']) {
    await page.evaluate(value => { document.documentElement.dataset.theme = value; }, theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.emulateMedia({ forcedColors: 'active' });
  const method = page.getByLabel('右のWebP圧縮メソッド');
  await method.focus();
  await method.press('ArrowRight');
  await expect(method).toBeFocused();
  await expect(method).toHaveValue('5');
  await expect(status).toContainText('完了');
  expect(requests.some(url => /^http:\/\/127\.0\.0\.1:4173\/web-toolbox\/assets\/worker-/.test(url))).toBe(true);
  expect(requests.filter(url => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173/web-toolbox/'))).toEqual([]);
});

test('lossy WebP shares SSIMULACRA2 evaluation with JPEG and AVIF', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles({ name: 'mixed.png', mimeType: 'image/png', buffer: rgbaPng(127, 97) });
  await page.getByLabel('左の出力形式').selectOption('image/webp');
  const scores = page.locator('.image-score');
  const finiteScore = /^-?\d+\.\d$/;
  await expect(scores.first()).toHaveText(finiteScore);
  await expect(scores.last()).toHaveText(finiteScore);
  await page.getByLabel('画質の自動評価').uncheck();
  await page.getByLabel('右の出力形式').selectOption('image/avif');
  await page.getByLabel('左のWebP品質').fill('100');
  await page.getByRole('button', { name: '画質を評価' }).click();
  await expect(scores.first()).toHaveText(finiteScore);
  await expect(scores.last()).toHaveText(finiteScore);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('WebP cancels WASM loading and can retry after a fetch failure', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  const status = page.locator('.image-panel[data-side=right] .image-webp-status');
  const cancel = page.getByRole('button', { name: '右側のWebP変換を中止' });
  const retry = page.getByRole('button', { name: '右側のWebP変換を再試行' });
  const wasm = '**/web-toolbox/assets/libwebp-1.6.0-encoder-*.wasm';
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(wasm, async route => {
    await blocked;
    await route.abort().catch(() => {});
  }, { times: 1 });
  try {
    const requested = page.waitForRequest(wasm);
    await page.getByLabel('右の出力形式').selectOption('image/webp');
    await requested;
    await cancel.click();
    await expect(status).toContainText('中止しました');
    await expect(retry).toBeFocused();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect.poll(() => page.evaluate(async name => (await navigator.locks.query()).held?.some(lock => lock.name === name), imageWorkerLockName)).toBe(false);
  } finally {
    release();
  }

  await page.route(wasm, route => route.fulfill({ status: 503 }), { times: 1 });
  await retry.press('Enter');
  await expect(status).toContainText('失敗');
  await expect(retry).toBeFocused();
  await retry.press('Space');
  await expect(status).toContainText('完了');
  await expect(page.getByRole('button', { name: '右をダウンロード' })).toBeFocused();
  await expect.poll(() => page.workers().length).toBe(0);
});

test('WebP previews a 16-megapixel input and cancels during high-effort encoding', async ({ page }) => {
  test.setTimeout(90_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (event.data?.webpEncodeStarted !== true) return;
          event.stopImmediatePropagation();
          document.documentElement.dataset.webpEncodeStarted = 'true';
        });
      }
    };
  });
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  const input = page.locator('[type=file]');
  const format = page.getByLabel('右の出力形式');
  const preview = page.getByAltText('右側のプレビュー');
  const status = page.locator('.image-panel[data-side=right] .image-webp-status');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await input.setInputFiles({ name: '16mp.png', mimeType: 'image/png', buffer: rgbaPng(4000, 4000) });
  await expect(page.locator('.image-info')).toContainText('4000 × 4000 px');
  await format.selectOption('image/webp');
  await expect(status).toContainText('完了', { timeout: 45_000 });
  await expect(preview).toHaveJSProperty('naturalWidth', 4000);
  await expect(preview).toHaveJSProperty('naturalHeight', 4000);
  await expect(save).toBeEnabled();

  // Observe entry to the actual WASM encoder. The first message is consumed by
  // the test listener before the conversion client sees the normal result.
  await page.route('**/assets/worker-*.js', async route => {
    const worker = await route.fetch();
    const source = await worker.text();
    if (!source.includes('encode_webp')) return route.fulfill({ response: worker });
    await route.fulfill({ response: worker, body: `
      const instantiate = WebAssembly.instantiate;
      WebAssembly.instantiate = async (...args) => {
        const result = await instantiate(...args);
        const { encode_webp, ...rest } = result.instance.exports;
        return { instance: { exports: { ...rest, encode_webp(...params) {
          self.postMessage({ webpEncodeStarted: true });
          return encode_webp(...params);
        } } } };
      };
      ${source}
    ` });
  });
  await page.locator('.image-panel[data-side=right]').evaluate(panel => {
    panel.querySelector<HTMLInputElement>('.image-webp-lossless')!.click();
    const quality = panel.querySelector<HTMLInputElement>('.image-webp-quality')!;
    quality.value = '100';
    quality.dispatchEvent(new Event('input'));
    const method = panel.querySelector<HTMLInputElement>('.image-webp-method')!;
    method.value = '6';
    method.dispatchEvent(new Event('input'));
  });
  await expect(page.locator('html')).toHaveAttribute('data-webp-encode-started', 'true', { timeout: 20_000 });
  await page.getByRole('button', { name: '右側のWebP変換を中止' }).click();
  await expect(status).toContainText('中止しました');
  await expect(save).toBeDisabled();
  await expect.poll(() => page.workers().length).toBe(0);
});

test('MozJPEG loads on demand, composites white, saves and reopens JPEG on the deployment subpath', async ({ page, context, browserName }) => {
  test.setTimeout(60_000);
  const requests: string[] = [];
  context.on('request', request => requests.push(request.url()));
  await page.goto('./');
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  const input = page.locator('[type=file]');
  await input.setInputFiles(await testImage(page, 127, 97));

  const left = page.getByLabel('左の出力形式');
  const right = page.getByLabel('右の出力形式');
  await expect(left).toHaveValue('original');
  await expect(right).toHaveValue('image/jpeg');
  await expect(right.locator('option')).toHaveText([
    'Original', 'AVIF (libaom)', 'Browser JPEG', 'Browser PNG', 'JPEG (MozJPEG)', 'JPEG XL (libjxl)', 'Oxipng', 'WebP (libwebp)',
  ]);
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await expect(save).toBeEnabled();
  expect(requests.some(url => /mozjpeg|\/assets\/worker-/.test(url))).toBe(false);

  const wasm = page.waitForResponse('**/web-toolbox/assets/mozjpeg-4.1.5-encoder-*.wasm');
  await right.selectOption('mozjpeg');
  expect((await wasm).ok()).toBe(true);
  const preview = page.getByAltText('右側のプレビュー');
  await expect(preview).toBeVisible();
  const pixels = await preview.evaluate(element => {
    const image = element as HTMLImageElement;
    const canvas = new OffscreenCanvas(image.naturalWidth, image.naturalHeight);
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    return [...context.getImageData(8, 8, 1, 1).data, ...context.getImageData(112, 80, 1, 1).data];
  });
  expect(pixels.slice(0, 3).every(value => value >= 250)).toBe(true);
  expect(pixels[3]).toBe(255);
  expect(pixels[4]).toBeGreaterThan(240);
  expect(pixels[5]).toBeLessThan(15);
  expect(pixels[6]).toBeLessThan(15);

  await left.selectOption('mozjpeg');
  await expect(page.getByAltText('左側のプレビュー')).toBeVisible();
  expect(requests.filter(url => /mozjpeg-4\.1\.5-encoder/.test(url))).toHaveLength(1);
  const baseline = page.getByLabel('右のMozJPEGプログレッシブJPEG');
  const optimize = page.getByLabel('右のMozJPEGハフマン符号化最適化');
  const quality = page.getByLabel('右のMozJPEG品質');
  await expect(optimize).toBeDisabled();
  await baseline.press('Space');
  await expect(optimize).toBeEnabled();
  await optimize.press('Space');
  await page.getByLabel('右のMozJPEG色差サンプリング').selectOption('444');
  await quality.fill('90');
  await right.selectOption('image/jpeg');
  await right.selectOption('mozjpeg');
  await expect(quality).toHaveValue('90');
  await expect(optimize).not.toBeChecked();
  await expect(page.getByLabel('左のMozJPEG品質')).toHaveValue('75');
  await expect(page.getByLabel('左のMozJPEGハフマン符号化最適化')).toBeDisabled();
  const output = await saveBrowserImage(page, save, 'sample.alpha-right-mozjpeg-q90-444-b-noopt.jpg', browserName);
  expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
  expect(output.subarray(-2)).toEqual(Buffer.from([0xff, 0xd9]));
  expect(output.includes(Buffer.from([0xff, 0xc0]))).toBe(true);
  await right.selectOption('original');
  await left.selectOption('original');
  await input.setInputFiles({ name: 'roundtrip.jpg', mimeType: 'image/jpeg', buffer: output });
  await expect(page.locator('.image-filename')).toHaveText('roundtrip.jpg');
  await expect(page.locator('.image-original-layer canvas')).toHaveJSProperty('width', 127);
  expect(requests.some(url => /\/web-toolbox\/assets\/worker-/.test(url))).toBe(true);
  expect(requests.filter(url => /^https?:/.test(url) && !url.startsWith('http://127.0.0.1:4173/web-toolbox/'))).toEqual([]);
});

test('MozJPEG shares a fetch, survives one-side cancel, and recovers from a failed replacement', async ({ page }) => {
  test.setTimeout(60_000);
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  const input = page.locator('[type=file]');
  await input.setInputFiles(await testImage(page));
  const left = page.getByLabel('左の出力形式');
  const right = page.getByLabel('右の出力形式');
  const wasm = '**/web-toolbox/assets/mozjpeg-4.1.5-encoder-*.wasm';
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  let unblockOld!: () => void;
  const oldInput = new Promise<void>(resolve => { unblockOld = resolve; });
  let markOldRequested!: () => void;
  const oldRequest = new Promise<void>(resolve => { markOldRequested = resolve; });
  let requests = 0;
  let phase: 'share' | 'hold-old' | 'fail-new' | 'allow' = 'share';
  await page.route(wasm, async route => {
    ++requests;
    if (phase === 'hold-old') {
      markOldRequested();
      await oldInput;
      return route.abort().catch(() => {});
    }
    if (phase === 'fail-new') {
      phase = 'allow';
      return route.fulfill({ status: 503 });
    }
    if (phase === 'share') await blocked;
    await route.continue().catch(() => {});
  });
  const pending = page.waitForRequest(wasm);
  try {
    await right.selectOption('mozjpeg');
    await pending;
    const holdsLock = () => page.evaluate(async name =>
      (await navigator.locks.query()).held?.some(lock => lock.name === name) ?? false, imageWorkerLockName);
    await expect.poll(holdsLock).toBe(true);
    await left.selectOption('mozjpeg');
    await page.getByRole('button', { name: '左側のMozJPEG変換を中止' }).press('Enter');
    await expect(page.getByRole('button', { name: '左側のMozJPEG変換を再試行' })).toBeFocused();
  } finally {
    release();
  }
  await expect(page.getByRole('button', { name: '右をダウンロード' })).toBeEnabled();
  await page.getByRole('button', { name: '左側のMozJPEG変換を再試行' }).press('Space');
  await expect(page.getByRole('button', { name: '左をダウンロード' })).toBeEnabled();
  expect(requests).toBe(1);

  try {
    phase = 'hold-old';
    await page.getByLabel('右のMozJPEG品質').fill('90');
    await oldRequest;
    phase = 'fail-new';
    await left.selectOption('original');
    const replacement = await testImage(page, 91, 55);
    await input.setInputFiles({ ...replacement, name: 'replacement.png' });
    await expect(page.locator('.image-filename')).toHaveText('replacement.png');
  } finally {
    unblockOld();
  }
  await expect(page.locator('.image-panel[data-side=right] .image-mozjpeg-status')).toContainText('失敗');
  const retry = page.getByRole('button', { name: '右側のMozJPEG変換を再試行' });
  await retry.press('Enter');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await expect(save).toBeFocused();
  await expect(page.getByAltText('右側のプレビュー')).toHaveJSProperty('naturalWidth', 91);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('MozJPEG compares with Browser JPEG, AVIF and WebP through the shared evaluation queue', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles({ name: 'mixed.png', mimeType: 'image/png', buffer: rgbaPng(127, 97) });
  await page.getByLabel('左の出力形式').selectOption('mozjpeg');
  const scores = page.locator('.image-score');
  const finiteScore = /^-?\d+\.\d$/;
  await expect(scores.first()).toHaveText(finiteScore);
  await expect(scores.last()).toHaveText(finiteScore);
  await page.getByLabel('画質の自動評価').uncheck();

  let maxWorkers = 0;
  page.on('worker', () => { maxWorkers = Math.max(maxWorkers, page.workers().length); });
  await page.getByLabel('左のMozJPEG品質').fill('100');
  for (const format of ['image/avif', 'image/webp']) {
    await page.getByLabel('右の出力形式').selectOption(format);
    await page.getByRole('button', { name: '画質を評価' }).click();
    await expect(scores.first()).toHaveText(finiteScore);
    await expect(scores.last()).toHaveText(finiteScore);
    await expect.poll(() => page.workers().length).toBe(0);
  }
  expect(maxWorkers).toBe(1);
});

test('MozJPEG previews and saves a 16-megapixel input and cancels active encoding', async ({ page, browserName }) => {
  test.setTimeout(120_000);
  await page.addInitScript(() => {
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(url: string | URL, options?: WorkerOptions) {
        super(url, options);
        this.addEventListener('message', event => {
          if (event.data?.mozjpegEncodeStarted !== true) return;
          event.stopImmediatePropagation();
          document.documentElement.dataset.mozjpegEncodeStarted = 'true';
        });
      }
    };
  });
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  const input = page.locator('[type=file]');
  const format = page.getByLabel('右の出力形式');
  const preview = page.getByAltText('右側のプレビュー');
  const status = page.locator('.image-panel[data-side=right] .image-mozjpeg-status');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  await input.setInputFiles({ name: '16mp.png', mimeType: 'image/png', buffer: rgbaPng(4000, 4000) });
  await expect(page.locator('.image-info')).toContainText('4000 × 4000 px');
  await format.selectOption('mozjpeg');
  await expect(status).toContainText('完了', { timeout: 60_000 });
  await expect(preview).toHaveJSProperty('naturalWidth', 4000);
  await expect(preview).toHaveJSProperty('naturalHeight', 4000);
  const output = await saveBrowserImage(page, save, '16mp-right-mozjpeg-q75-420-p-opt.jpg', browserName);
  expect(output.subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));

  // Observe entry to the actual WASM encoder. The first message is consumed by
  // the test listener before the conversion client sees the normal result.
  await page.route('**/assets/worker-*.js', async route => {
    const worker = await route.fetch();
    const source = await worker.text();
    if (!source.includes('mozjpeg_encode')) return route.fulfill({ response: worker });
    await route.fulfill({ response: worker, body: `
      const instantiate = WebAssembly.instantiate;
      WebAssembly.instantiate = async (...args) => {
        const result = await instantiate(...args);
        const { mozjpeg_encode, ...rest } = result.instance.exports;
        return { instance: { exports: { ...rest, mozjpeg_encode(...params) {
          self.postMessage({ mozjpegEncodeStarted: true });
          return mozjpeg_encode(...params);
        } } } };
      };
      ${source}
    ` });
  });
  await page.getByLabel('右のMozJPEG色差サンプリング').selectOption('444');
  await expect(page.locator('html')).toHaveAttribute('data-mozjpeg-encode-started', 'true', { timeout: 20_000 });
  await page.getByRole('button', { name: '右側のMozJPEG変換を中止' }).click();
  await expect(status).toContainText('中止しました');
  await expect(save).toBeDisabled();
  await expect.poll(() => page.workers().length).toBe(0);
});

test('JPEG XL checks native decoding, loads the encoder on demand, and previews, scores and reopens output', async ({ page, context, browserName }) => {
  test.setTimeout(60_000);
  const probe = Buffer.from(await jxlProbeBlob().arrayBuffer());
  const requests: string[] = [];
  context.on('request', request => requests.push(request.url()));
  await page.goto('./?tool=image-converter');
  const support = await page.evaluate(async bytes => {
    const blob = new Blob([Uint8Array.from(bytes)], { type: 'image/jxl' });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.src = url;
    try {
      const preview = await image.decode().then(() => true, () => false);
      const input = await createImageBitmap(image).then(bitmap => { bitmap.close(); return true; }, () => false);
      if (!preview) return { preview, input, scoring: false };

      const script = new Blob([`
        onmessage = async ({ data }) => {
          try {
            const bitmap = await createImageBitmap(data);
            bitmap.close();
            postMessage(true);
          } catch {
            postMessage(false);
          }
        };
      `], { type: 'text/javascript' });
      const workerUrl = URL.createObjectURL(script);
      const worker = new Worker(workerUrl);
      try {
        const scoring = await new Promise<boolean>((resolve, reject) => {
          worker.onmessage = ({ data }) => resolve(data === true);
          worker.onerror = reject;
          worker.postMessage(blob);
        });
        return { preview, input, scoring };
      } finally {
        worker.terminate();
        URL.revokeObjectURL(workerUrl);
      }
    } finally {
      URL.revokeObjectURL(url);
    }
  }, [...probe]);

  const input = page.locator('[type=file]');
  const format = page.getByLabel('右の出力形式');
  const option = format.locator('option[value="image/jxl"]');
  const status = page.locator('.image-panel[data-side=right] .image-jxl-status');
  const score = page.locator('.image-panel[data-side=right] .image-score');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  const preview = page.getByAltText('右側のプレビュー');
  const assets = () => requests.filter(url => /libjxl-0\.13\.0-encoder-.*\.wasm/.test(url));
  if (!support.preview) {
    await expect(option).toBeDisabled();
    await expect(page.locator('.image-jxl-compatibility')).toHaveText(/JPEG XLの入力と出力を利用できません/);
    await input.setInputFiles({ name: 'valid.jxl', mimeType: 'image/jxl', buffer: probe });
    await expect(page.locator('.image-input-error')).toHaveText(/JPEG XLの入力を利用できません/);
    expect(assets()).toEqual([]);
    return;
  }

  await expect(option).toBeEnabled();
  await page.getByLabel('画質の自動評価').uncheck();
  await input.setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: rgbaPng(31, 29) });
  await expect(save).toBeEnabled();
  expect(assets()).toEqual([]);

  const wasmPath = '**/web-toolbox/assets/libjxl-0.13.0-encoder-*.wasm';
  const cancel = page.getByRole('button', { name: '右側のJPEG XL変換を中止' });
  const retry = page.getByRole('button', { name: '右側のJPEG XL変換を再試行' });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(wasmPath, async route => {
    await blocked;
    await route.abort().catch(() => {});
  }, { times: 1 });
  try {
    const requested = page.waitForRequest(wasmPath);
    await format.selectOption('image/jxl');
    await requested;
    await cancel.click();
    await expect(status).toContainText('中止しました');
    await expect(save).toBeDisabled();
    await expect.poll(() => page.workers().length).toBe(0);
  } finally {
    release();
  }

  await page.route(wasmPath, route => route.fulfill({ status: 503 }), { times: 1 });
  await retry.click();
  await expect(status).toContainText('失敗');
  await expect(save).toBeDisabled();
  const wasm = page.waitForResponse(wasmPath);
  await retry.click();
  expect((await wasm).ok()).toBe(true);
  await expect(status).toHaveText('JPEG XL変換が完了しました。');
  await expect(preview).toBeVisible();
  await expect(preview).toHaveJSProperty('naturalWidth', 31);
  await expect(preview).toHaveJSProperty('naturalHeight', 29);
  await page.getByRole('button', { name: '画質を評価' }).click();
  if (support.scoring) await expect(score).toHaveText(/^-?\d+\.\d$/);
  else await expect(score).toHaveText(/JPEG XLの画質評価を利用できません/);
  await expect(save).toBeEnabled();

  const lossless = page.getByLabel('右側のJPEG XLを可逆圧縮にする');
  const distance = page.getByLabel('右のJPEG XL Distance');
  await distance.fill('0.5');
  await lossless.check();
  await expect(distance).toBeDisabled();
  await expect(distance).toHaveValue('0');
  await expect(page.locator('.image-panel[data-side=right] .image-jxl-distance + span')).toHaveText('0');
  await expect(score).toHaveText('可逆圧縮（スコア評価対象外）');
  const result = await saveBrowserImage(page, save, 'sample-right-jxl-lossless-e7.jxl', browserName);
  expect(isJxl(result)).toBe(true);

  // Firefox can open the saved image in its own page.
  if (browserName === 'firefox') await page.goto('./?tool=image-converter');
  else {
    await lossless.uncheck();
    await expect(distance).toHaveValue('0.5');
  }
  await input.setInputFiles({ name: 'roundtrip.jxl', mimeType: 'image/jxl', buffer: result });
  if (!support.input) {
    await expect(page.locator('.image-input-error')).toHaveText(/JPEG XLの入力を利用できません/);
  } else {
    await expect(page.locator('.image-info')).toHaveText(/roundtrip\.jxl.*31 × 29 px/);
    const original = await saveBrowserImage(page, page.getByRole('button', { name: '左をダウンロード' }), 'roundtrip.jxl', browserName);
    expect(original).toEqual(result);
    if (browserName === 'firefox') await page.goto('./?tool=image-converter');

    // Wrap the raw probe in the standard signature, file type and codestream boxes.
    const header = Buffer.from('0000000c4a584c200d0a870a00000014667479706a786c20000000006a786c20', 'hex');
    const codestreamBox = Buffer.alloc(8);
    codestreamBox.writeUInt32BE(8 + probe.length);
    codestreamBox.write('jxlc', 4);
    const container = Buffer.concat([header, codestreamBox, probe]);
    await input.setInputFiles({ name: 'container.jxl', mimeType: 'image/jxl', buffer: container });
    await expect(page.locator('.image-info')).toHaveText(/container\.jxl.*2 × 2 px/);
    await input.setInputFiles({ name: 'corrupt.jxl', mimeType: 'image/jxl', buffer: probe.subarray(0, 2) });
    await expect(page.locator('.image-input-error')).toHaveText(/画像を読み込めませんでした/);
    await expect(page.locator('.image-filename')).toHaveText('container.jxl');
  }
});

test('JPEG XL explains unavailable preview support and leaves the default conversion available', async ({ page, context }) => {
  const jxlRequests: string[] = [];
  context.on('request', request => {
    if (request.url().includes('libjxl-0.13.0-encoder')) jxlRequests.push(request.url());
  });
  await page.addInitScript(() => {
    const jxlUrls = new Set<string>();
    const createUrl = URL.createObjectURL;
    const decode = HTMLImageElement.prototype.decode;
    URL.createObjectURL = object => {
      const url = createUrl(object);
      if (object instanceof Blob && object.type === 'image/jxl') jxlUrls.add(url);
      return url;
    };
    HTMLImageElement.prototype.decode = function () {
      if (jxlUrls.has(this.src)) return Promise.reject(new DOMException('Unsupported format', 'EncodingError'));
      return decode.call(this);
    };
  });
  await page.goto('./?tool=image-converter');
  await expect(page.locator('.image-jxl-compatibility')).toHaveText(/JPEG XLの入力と出力を利用できません/);
  await expect(page.getByLabel('右の出力形式').locator('option[value="image/jxl"]')).toBeDisabled();
  const input = page.locator('[type=file]');
  await input.setInputFiles({ name: 'valid.jxl', mimeType: 'image/jxl', buffer: Buffer.from(await jxlProbeBlob().arrayBuffer()) });
  await expect(page.locator('.image-input-error')).toHaveText(/JPEG XLの入力を利用できません/);
  await input.setInputFiles(await testImage(page));
  await expect(page.getByLabel('右の出力形式')).toHaveValue('image/jpeg');
  await expect(page.getByRole('button', { name: '右をダウンロード' })).toBeEnabled();
  expect(jxlRequests).toEqual([]);
});
