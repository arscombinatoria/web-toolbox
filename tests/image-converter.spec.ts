import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

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
  const formatLeft = page.getByLabel('左の形式');
  const formatRight = page.getByLabel('右の形式');
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
  await expect(leftPanel.getByRole('status')).toHaveText(/元ファイル比 0%/);
  const leftBounds = (await leftPanel.boundingBox())!;
  const rightBounds = (await rightPanel.boundingBox())!;
  expect(leftBounds.y).toBe(rightBounds.y);
  expect(leftBounds.x + leftBounds.width).toBeLessThan(rightBounds.x);

  const split = page.getByRole('slider', { name: '比較位置' });
  const initialUrl = await previewRight.getAttribute('src');
  await expect(split).toHaveValue('50');
  await split.press('ArrowRight');
  await expect(split).toHaveValue('51');
  await expect(split).toHaveAttribute('aria-valuetext', '左側 51%');
  await split.scrollIntoViewIfNeeded();
  const bounds = (await split.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 4, bounds.y + bounds.height / 2);
  await page.mouse.up();
  expect(Number(await split.inputValue())).toBeLessThan(30);
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
  const sizeFormat = new Intl.NumberFormat('ja-JP');
  const percentFormat = new Intl.NumberFormat('ja-JP', { signDisplay: 'exceptZero', maximumFractionDigits: 2 });
  for (const [panel, bytes] of [[leftPanel, leftJpeg], [rightPanel, png]] as const) {
    const percent = (bytes.length - image.buffer.length) / image.buffer.length * 100;
    await expect(panel.getByRole('status')).toHaveText(
      `出力サイズ ${sizeFormat.format(bytes.length)} B（元ファイル比 ${percentFormat.format(percent)}%）`,
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
  await expect(leftPanel.getByRole('status')).toHaveText(/元ファイル比 0%/);
  await expect(rightPanel.getByRole('status')).toHaveText(/元ファイル比 0%/);
  expect(await saveImage(page, saveLeft, image.name)).toEqual(image.buffer);
  expect(await saveImage(page, saveRight, image.name)).toEqual(image.buffer);

  await page.getByRole('navigation').getByRole('link', { name: '全角・半角変換' }).click();
  await page.goBack();
  await expect(page.locator('.image-drop')).toBeVisible();
  await expect(saveLeft).toBeHidden();
  await expect(saveRight).toBeHidden();
});

test('320pxの両テーマでドロップ後も失敗した置換から復帰できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const scheme of ['dark', 'light'] as const) {
    await page.goto('./?tool=image-converter');
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const initial = page.locator('.image-drop');
    const initialBounds = (await initial.boundingBox())!;
    expect(initialBounds.height).toBe(180);
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
    const comparisonBounds = (await page.locator('.image-comparison-area').boundingBox())!;
    expect(comparisonBounds.y).toBeCloseTo(initialBounds.y, 0);
    expect(comparisonBounds.width).toBeCloseTo(initialBounds.width, 0);
    await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    const inputError = page.locator('.image-input-error');
    await expect(inputError).toHaveAttribute('role', 'alert');
    await expect(inputError).toContainText('読み込めません');
    await expect(page.locator('.image-tool section')).toBeVisible();
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
  expect((await initial.boundingBox())!.height).toBe(240);
  const initialPicker = page.waitForEvent('filechooser');
  await initial.press('Enter');
  await (await initialPicker).setFiles(image);
  const comparison = page.locator('.image-comparison-area');
  const info = page.locator('.image-info');
  const rightPreview = page.getByAltText('右側のプレビュー');
  await expect(info).toContainText(image.name);

  const drag = await comparison.evaluate((area, bytes) => {
    const slider = area.querySelector('.image-position')!;
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
    const picker = page.waitForEvent('filechooser');
    await change.click();
    await (await picker).setFiles(image);
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
  await expect(left.getByRole('status')).toHaveText(/元ファイル比 0%/);

  await left.getByLabel('左の形式').selectOption('image/png');
  await expect(left.getByRole('alert')).toContainText('左側：指定形式に変換できませんでした');
  await expect(left.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('alert')).toContainText('指定形式に変換できませんでした');
  await expect(right.getByRole('button')).toBeDisabled();
  await expect(left.getByRole('status')).toBeEmpty();
  await right.getByLabel('右の形式').selectOption('original');
  await expect(right.getByRole('alert')).toBeEmpty();
  await expect(left.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('button')).toBeEnabled();
  await expect(right.getByRole('status')).toHaveText(/元ファイル比 0%/);
});

test.describe('タッチ操作', () => {
  test.use({ hasTouch: true, viewport: { width: 360, height: 720 } });

  test('比較位置をタップしても再変換しない', async ({ page }) => {
    await page.goto('./?tool=image-converter');
    await page.locator('[type=file]').setInputFiles(await testImage(page));
    const preview = page.getByAltText('右側のプレビュー');
    await expect(preview).toBeVisible();
    const url = await preview.getAttribute('src');
    const split = page.getByRole('slider', { name: '比較位置' });
    await split.scrollIntoViewIfNeeded();
    const bounds = (await split.boundingBox())!;
    await page.touchscreen.tap(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
    expect(Number(await split.inputValue())).toBeGreaterThan(65);
    await expect(preview).toHaveAttribute('src', url!);
  });
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
      const { reference, jpegs } = message as { reference: ImageBitmap; jpegs: Blob[] };
      const { width, height } = reference;
      const normalizer = new OffscreenCanvas(width, height);
      const original = read(reference, normalizer);
      checks.push({
        referenceMatches: jpegs.every(blob => encodings.get(blob)?.every((byte, i) => byte === original[i])),
        decodesMatch: Promise.all(jpegs.map(async blob => {
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
  const jpegScore = /^SSIMULACRA2: -?\d+\.\d$/;
  const button = page.getByRole('button', { name: '画質を評価', exact: true });
  const left = page.locator('.image-panel[data-side=left] .image-score');
  const right = page.locator('.image-panel[data-side=right] .image-score');
  const status = page.locator('.image-evaluation-status');
  const input = await testImage(page);
  await page.getByRole('checkbox', { name: '画質の自動評価' }).uncheck();
  await page.locator('[type=file]').setInputFiles(input);
  await expect(left).toHaveText('基準画像');
  await page.getByLabel('左の形式').selectOption('image/jpeg');
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
  expect(Number((await right.textContent())?.split(': ')[1])).toBeLessThan(100);
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
  await page.getByLabel('左の形式').selectOption('image/png');
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
  const jpegScore = /^SSIMULACRA2: -?\d+\.\d$/;
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
  await expect(score).toHaveText('画質は未評価');
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
  await expect(page.locator('.image-panel[data-side=right] .image-score')).toHaveText(/^SSIMULACRA2: -?\d+\.\d$/);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('評価の画素数を超えてもJPEGの変換と保存が使える', async ({ page }) => {
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const image = await testImage(page, 1985, 2113);
  await page.locator('[type=file]').setInputFiles({ ...image, name: 'large.png' });
  await expect(page.locator('.image-evaluation-limit')).toContainText('4,194,304画素');
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
  const scoringLockHeld = () => page.evaluate(async () => {
    const { held } = await navigator.locks.query();
    return held?.some(lock => lock.name?.startsWith('web-toolbox:image-quality:')) ?? false;
  });
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
  await expect(page.getByRole('button', { name: '右をダウンロード' })).toBeEnabled();
  await start.click();
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(/^SSIMULACRA2: /);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect(auto).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
