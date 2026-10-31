import ExcelJS from 'exceljs-community';
import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

test('初期サンプル・方向切り替え・編集・空入力・エラー・クリア・既存ツール切り替え', async ({ page }) => {
  await page.goto('./?tool=markdown-table');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  const markdown = '| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 3 | 青森県産 |\n| みかん | 5 | 愛媛県産 |';
  const tsv = '品名\t数量\t備考\r\nりんご\t3\t青森県産\r\nみかん\t5\t愛媛県産';
  await expect(input).toHaveValue(markdown);
  await expect(output).toHaveValue(tsv.replace(/\r\n/g, '\n'));
  await expect(page.getByRole('radio', { name: 'Markdown → Excel' })).toBeChecked();
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Excelをダウンロード' })).toBeEnabled();

  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(input).toHaveValue(tsv.replace(/\r\n/g, '\n'));
  await expect(output).toHaveValue(markdown);
  await expect(page.getByRole('button', { name: 'Excelをダウンロード' })).toBeHidden();
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await expect(input).toHaveValue(markdown);
  await expect(output).toHaveValue(tsv.replace(/\r\n/g, '\n'));

  await input.fill('| 品名 | 説明 |\n| --- | --- |\n| りんご | 青森<br>甘い |');
  await expect(output).toHaveValue('品名\t説明\nりんご\t"青森\n甘い"');
  await expect(output).toHaveAttribute('readonly', '');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(input).toHaveValue('品名\t説明\nりんご\t"青森\n甘い"');
  await expect(output).toHaveValue('| 品名 | 説明 |\n| --- | --- |\n| りんご | 青森<br>甘い |');
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await expect(output).toHaveValue('品名\t説明\nりんご\t"青森\n甘い"');

  await page.getByRole('button', { name: '入力をクリア' }).click();
  await expect(input).toHaveValue('');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(input).toHaveValue('');
  await expect(output).toHaveValue('');
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Excelをダウンロード' })).toBeHidden();

  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await input.fill('"unclosed');
  await expect(page.getByRole('alert')).toContainText('ヘッダー');
  await expect(output).toHaveValue('');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(input).toHaveValue('"unclosed');
  await expect(page.getByRole('alert')).toContainText('引用符');
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeDisabled();
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await expect(input).toHaveValue('"unclosed');
  await expect(page.getByRole('alert')).toContainText('ヘッダー');

  await page.getByRole('button', { name: '入力をクリア' }).click();
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(input).toHaveValue('');
  await expect(page.getByRole('alert')).toBeEmpty();
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await input.fill('Ａ');
  await expect(output).toHaveValue('A');
  await page.goBack();
  await expect(input).toHaveValue(markdown);
  await expect(output).toHaveValue(tsv.replace(/\r\n/g, '\n'));
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
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await expect(page.getByRole('status')).toHaveText('コピーしました。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('品名\t数量\t備考\r\nりんご\t3\t青森県産\r\nみかん\t5\t愛媛県産');
  expect(scripts.some(url => /\/xlsx-/.test(url))).toBe(false);
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excelをダウンロード' }).click();
  const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('table.xlsx');
  const book = new ExcelJS.Workbook();
  await book.xlsx.load(new Uint8Array(await readFile((await download.path())!)).buffer);
  const sheet = book.getWorksheet('Table')!;
  expect(sheet.getCell('A2').value).toBe('りんご');
  expect(sheet.getCell('A2').type).toBe(ExcelJS.ValueType.String);
  expect(sheet.getCell('B2').value).toBe('3');
  expect(scripts.some(url => /\/xlsx-/.test(url))).toBe(true);
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await page.getByRole('button', { name: '結果をコピー' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 3 | 青森県産 |\n| みかん | 5 | 愛媛県産 |');
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
