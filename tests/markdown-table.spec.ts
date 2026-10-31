import ExcelJS from 'exceljs-community';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

test('方向切り替え・結果更新・エラー・クリア・既存ツールとの切り替え', async ({ page }) => {
  await page.goto('./?tool=markdown-table');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await input.fill('| 品名 | 説明 |\n| --- | --- |\n| りんご | 青森<br>甘い |');
  await expect(output).toHaveValue('品名\t説明\nりんご\t"青森\n甘い"');
  await expect(output).toHaveAttribute('readonly', '');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(page.getByRole('button', { name: 'Excelをダウンロード' })).toBeHidden();
  await input.fill('品名\t説明\r\nりんご\t"青森\n甘い"');
  await expect(output).toHaveValue('| 品名 | 説明 |\n| --- | --- |\n| りんご | 青森<br>甘い |');
  await input.fill('"unclosed');
  await expect(page.getByRole('alert')).toContainText('引用符');
  await expect(output).toHaveValue('');
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await input.fill('a|b\n---|---\nx');
  await expect(page.getByRole('alert')).toContainText('列数');
  await page.getByRole('button', { name: '入力をクリア' }).click();
  await expect(input).toHaveValue('');
  await expect(input).toBeFocused();
  await expect(page.getByRole('alert')).toBeEmpty();
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await input.fill('Ａ');
  await expect(output).toHaveValue('A');
  await page.goBack();
  await expect(input).toHaveValue('');
});

test('実Clipboard API・失敗通知・遅延ロード・実XLSXダウンロード・非保存', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const scripts: string[] = [];
  const dataRequests: string[] = [];
  page.on('request', request => {
    if (request.resourceType() === 'script') scripts.push(request.url());
    if (['xhr', 'fetch'].includes(request.resourceType())) dataRequests.push(request.url());
  });
  await page.goto('./?tool=markdown-table');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('| 番号 | 説明 |\n| --- | --- |\n| 00123 | 青森<br>甘い |');
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await expect(page.getByRole('status')).toHaveText('コピーしました。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('番号\t説明\r\n00123\t"青森\n甘い"');
  expect(scripts.some(url => /\/xlsx-/.test(url))).toBe(false);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excelをダウンロード' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('table.xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await readFile((await download.path())!)).buffer);
  const sheet = book.getWorksheet('Table')!;
  expect(sheet.getCell('A2').value).toBe('00123');
  expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell('B2').value).toBe('青森\n甘い');
  expect(scripts.some(url => /\/xlsx-/.test(url))).toBe(true);
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('h\nx');
  await page.getByRole('button', { name: '結果をコピー' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('| h |\n| --- |\n| x |');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); });
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await expect(page.getByRole('status')).toContainText('コピーできませんでした');
  expect(dataRequests).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('モバイルの両テーマ・長文・キーボード操作', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?tool=markdown-table');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill(`| h |\n| --- |\n| ${'長文'.repeat(1000)} |`);
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('textbox', { name: '変換結果' })).toBeVisible();
  }
  await page.getByRole('radio', { name: 'Markdown → Excel' }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('radio', { name: 'Excel → Markdown' })).toBeChecked();
});
