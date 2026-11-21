import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

test('画像を選択・比較してJPEGとPNGを保存し、画面を離れる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const png = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 64; canvas.height = 32;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(32, 0, 32, 32);
    return canvas.toDataURL().split(',')[1]!;
  });
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /画像を選択/ }).press('Enter');
  await (await picker).setFiles({ name: 'sample.alpha.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') });
  const save = page.getByRole('button', { name: 'ダウンロード' });
  await expect(save).toBeEnabled();
  await expect(page.getByAltText('変換後のプレビュー')).toBeVisible();
  await expect(page.locator('.image-info')).toContainText('64 × 32 px');
  const split = page.getByRole('slider', { name: '比較位置' });
  const preview = page.getByAltText('変換後のプレビュー');
  const initialUrl = await preview.getAttribute('src');
  await expect(split).toHaveValue('50');
  await split.press('ArrowRight');
  await expect(split).toHaveValue('51');
  const bounds = (await split.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 4, bounds.y + bounds.height / 2);
  await page.mouse.up();
  expect(Number(await split.inputValue())).toBeLessThan(30);
  await expect(preview).toHaveAttribute('src', initialUrl!);
  await page.getByRole('slider', { name: 'JPEG品質' }).press('ArrowLeft');
  await expect(page.locator('.image-quality span')).toHaveText('0.74');
  await expect(preview).not.toHaveAttribute('src', initialUrl!);
  for (const ext of ['jpg', 'png']) {
    if (ext === 'png') {
      await page.getByLabel('出力形式').selectOption('image/png');
      await expect(page.getByRole('slider', { name: 'JPEG品質' })).toBeHidden();
    }
    await expect(save).toBeEnabled();
    const downloading = page.waitForEvent('download');
    await save.click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('sample.alpha.' + ext);
    const bytes = await readFile((await download.path())!);
    expect([...bytes.subarray(0, 3)]).toEqual(ext === 'jpg' ? [255, 216, 255] : [137, 80, 78]);
    const rgba = await preview.evaluate(img => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img as HTMLImageElement, 0, 0);
      return [...ctx.getImageData(0, 0, 1, 1).data];
    });
    if (ext === 'png') expect(rgba[3]).toBe(0);
    else expect(Math.min(...rgba)).toBeGreaterThan(245);
  }
  await page.getByRole('navigation').getByRole('link', { name: '全角・半角変換' }).click();
  await page.goBack();
  await expect(page.locator('.image-drop')).toBeVisible();
  await expect(save).toBeHidden();
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
    await expect(page.locator('.image-save')).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
    await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    await expect(page.getByRole('alert')).toContainText('読み込めません');
    await expect(page.locator('.image-save')).toBeDisabled();
  }
});

test('Canvasが変換に失敗したらエラーを通知し保存を無効にする', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const data = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const jpeg = canvas.toDataURL('image/jpeg').split(',')[1]!;
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
    return jpeg;
  });
  await page.locator('[type=file]').setInputFiles({
    name: 'input.jpg', mimeType: 'image/jpeg', buffer: Buffer.from(data, 'base64'),
  });
  await expect(page.getByRole('alert')).toContainText('指定形式に変換できませんでした');
  await expect(page.locator('.image-save')).toBeDisabled();
  await expect(page.locator('.image-result')).toBeEmpty();
});
