import { expect, test } from './fixtures';

test('両方向のMarkdownプレビューと配置変更', async ({ page }) => {
  await page.goto('./?tool=markdown-table');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  const preview = page.locator('.table-preview');
  await expect.poll(() => input.evaluate(element => getComputedStyle(element).fontFamily)).toContain('monospace');
  await expect.poll(() => output.evaluate(element => getComputedStyle(element).fontFamily)).toContain('monospace');
  const markdown = '| Name | Count |\n| --- | ---: |\n| **long name** | 3 |';
  await input.fill(markdown);
  await expect(page.getByText('入力Markdownのプレビュー')).toBeVisible();
  await expect(preview.locator('tbody strong')).toHaveText('long name');
  await expect(preview.locator('td.table-preview-align-right')).toHaveText('3');

  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await expect(page.getByText('変換結果Markdownのプレビュー')).toBeVisible();
  await expect(page.locator('[data-format-options]')).toBeVisible();
  await expect(page.locator('[data-column="1"]')).toHaveValue('right');
  const alignment = page.locator('[data-column="1"]');
  await alignment.focus();
  await page.keyboard.press('ArrowUp');
  await expect(alignment).toBeFocused();
  await expect(output).toHaveValue(/:---:/);
  await expect(preview.locator('thead th.table-preview-align-center')).toHaveCount(1);
  await expect(output).toHaveValue(/long name/);
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await expect(output).toHaveValue(/long name/);
  await expect(input).toHaveValue(/long name/);
  await expect(page.locator('[data-format-options]')).toBeHidden();
});

test('重複・空ヘッダーのアクセシブル名と配置キーボード操作', async ({ page }) => {
  await page.goto('./?tool=markdown-table');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await input.fill('same\t\tsame\nshort\tvalue\tend');
  const blankHeader = page.locator('[data-column="1"]');
  const duplicateHeader = page.locator('[data-column="2"]');
  await expect(page.locator('[data-column="0"]')).toHaveAttribute('aria-label', '列1（same）の配置');
  await expect(blankHeader).toHaveAttribute('aria-label', '列2（空のヘッダー）の配置');
  await expect(duplicateHeader).toHaveAttribute('aria-label', '列3（same）の配置');
  await blankHeader.focus();
  await page.keyboard.press('ArrowDown');
  await expect(blankHeader).toBeFocused();
  await expect(blankHeader).toHaveValue('left');
  await blankHeader.selectOption('center');
  await duplicateHeader.selectOption('right');
  await expect(output).toHaveValue(/\| --- \| :---: \| ---: \|/);
});

test('配置設定は51列のページをキーボード操作し、最大列数をコピーできる', async ({ page, context, browserName }) => {
  if (browserName === 'chromium') await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('./?tool=markdown-table');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  const headers = Array.from({ length: 51 }, (_, index) => `h${index}`);
  await input.fill(`${headers.join('\t')}\n${headers.map(() => 'x').join('\t')}`);
  await expect(page.locator('[data-column]')).toHaveCount(50);
  await expect(page.locator('[data-alignment-range]')).toHaveText('列 1〜50 を表示中（全 51 列）');
  const previous = page.getByRole('button', { name: '前の50列' });
  const next = page.getByRole('button', { name: '次の50列' });
  await expect(previous).toBeDisabled();
  await expect(next).toBeVisible();
  await next.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('[data-column]')).toHaveCount(1);
  await expect(page.locator('[data-column="50"]')).toHaveAttribute('aria-label', '列51（h50）の配置');
  await expect(page.locator('[data-alignment-range]')).toHaveText('列 51〜51 を表示中（全 51 列）');
  await expect(page.locator('[data-column="50"]')).toBeFocused();
  await page.locator('[data-column="50"]').selectOption('right');
  await expect(output).toHaveValue(/---:/);
  await expect(previous).toBeEnabled();
  await previous.focus(); await page.keyboard.press('Enter');
  await expect(page.locator('[data-column]')).toHaveCount(50);
  await expect(output).toHaveValue(/---:/);

  const maxHeaders = Array.from({ length: 16_384 }, (_, index) => `h${index}`);
  await input.fill(`${maxHeaders.join('\t')}\n${maxHeaders.map(() => 'x').join('\t')}`);
  await expect(page.locator('[data-column]')).toHaveCount(50);
  await expect(page.locator('[data-alignment-range]')).toHaveText('列 1〜50 を表示中（全 16,384 列）');
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeEnabled();
  if (browserName === 'chromium') {
    await page.getByRole('button', { name: '結果をコピー' }).click();
    await expect(page.getByRole('status')).toHaveText('コピーしました。');
    expect((await page.evaluate(() => navigator.clipboard.readText())).length).toBeGreaterThan(0);
  }
});

test('危険なHTMLとURLはテキスト表示し、プレビュー上限でも変換結果を使える', async ({ page }) => {
  const requests: string[] = [];
  const appOrigin = new URL('http://127.0.0.1:4173').origin;
  page.on('request', request => {
    if (new URL(request.url()).origin !== appOrigin) requests.push(request.url());
  });
  await page.route('**/*', route => new URL(route.request().url()).origin === appOrigin ? route.continue() : route.abort());
  await page.goto('./?tool=markdown-table');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('| H |\n| --- |\n| [click](javascript:alert(1)) ![alt](https://example.invalid/a.png) <img src="https://example.invalid/x" onerror="alert(1)"> |');
  const preview = page.locator('.table-preview-scroll');
  await expect(preview).toBeVisible();
  await expect(preview.locator('a, img, script, [src], [href], [style], [onerror]')).toHaveCount(0);
  await expect(preview).toContainText('click');
  await expect(preview.locator('.table-preview-image-alt')).toHaveText('alt');

  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  const tsvRows = Array.from({ length: 201 }, (_, index) => `${index === 0 ? 'H' : `row${index}`}`).join('\n');
  await input.fill(tsvRows);
  await expect(page.getByText(/プレビューは200行/)).toBeVisible();
  const expectedMarkdown = ['| H |', '| --- |', ...Array.from({ length: 200 }, (_, index) => `| row${index + 1} |`)].join('\n');
  await expect(page.getByRole('textbox', { name: '変換結果', exact: true })).toHaveValue(expectedMarkdown);
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeEnabled();
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await expect(page.getByRole('textbox', { name: '変換結果', exact: true })).toHaveValue(tsvRows);
  await expect(page.getByRole('button', { name: 'Excelをダウンロード' })).toBeEnabled();
  await expect(page.getByText(/プレビューは200行/)).toBeVisible();
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
});

test('320pxの両テーマで長い・横長のプレビューをスクロールできる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('./?tool=markdown-table');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const headers = Array.from({ length: 10 }, (_, index) => `header${index}`);
  const row = Array.from({ length: 10 }, () => 'long value '.repeat(8));
  await input.fill(`| ${headers.join(' | ')} |\n| ${headers.map(() => '---').join(' | ')} |\n| ${row.join(' | ')} |`);
  const scroll = page.getByRole('region', { name: '表のスクロール領域' });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await expect(scroll).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const overflow = await scroll.evaluate(element => element.scrollWidth > element.clientWidth);
    expect(overflow).toBe(true);
    await scroll.focus();
    await expect(scroll).toBeFocused();
    await scroll.evaluate(element => { element.scrollLeft = 0; });
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await page.keyboard.press('ArrowRight');
    await expect.poll(() => scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
});
