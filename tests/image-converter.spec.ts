import { readFile } from 'node:fs/promises';
import type { Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function testImage(page: Page) {
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(32, 0, 32, 32);
    return canvas.toDataURL().split(',')[1]!;
  });
  return { name: 'sample.alpha.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
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

test('画像を選択し、比較線と左右のエンコーダーを操作して個別に保存する', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /画像を選択/ }).press('Enter');
  await (await picker).setFiles(image);
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

test('狭い画面の両テーマでドロップ・失敗表示・再入力ができる', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 720 });
  await page.goto('./?tool=image-converter');
  for (const scheme of ['dark', 'light'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await page.locator('.image-drop').evaluate(async button => {
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
    const left = (await page.getByRole('group', { name: '左の設定' }).boundingBox())!;
    const right = (await page.getByRole('group', { name: '右の設定' }).boundingBox())!;
    expect(left.y + left.height).toBeLessThan(right.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    await expect(page.getByRole('alert')).toContainText('読み込めません');
    await expect(page.locator('.image-tool section')).toBeHidden();
  }
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
    const bounds = (await split.boundingBox())!;
    await page.touchscreen.tap(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
    expect(Number(await split.inputValue())).toBeGreaterThan(65);
    await expect(preview).toHaveAttribute('src', url!);
  });
});
