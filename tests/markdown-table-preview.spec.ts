import { expect, test } from './fixtures';

test('両方向のMarkdownプレビュー・配置変更・パディング往復制約', async ({ page }) => {
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

  const padding = page.getByRole('checkbox', { name: '列幅を揃える' });
  await expect(padding).not.toBeChecked();
  const warning = page.getByText('列幅調整用の空白が追加されます。Excelへ再変換する際に、追加された空白がセルの内容として残る場合があります。');
  await expect(warning).toBeHidden();
  await padding.check();
  await expect(warning).toBeVisible();
  await expect(output).toHaveValue(/long name/);
  await page.getByRole('radio', { name: 'Markdown → Excel' }).check();
  await expect(output).toHaveValue(/long name/);
  await expect(input).toHaveValue(/long name/);
  await expect(page.locator('[data-format-options]')).toBeHidden();
});

test('列の増減・重複と空ヘッダー・一時エラー・クリア時の状態', async ({ page }) => {
  await page.goto('./?tool=markdown-table');
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await input.fill('same\t\tsame\nshort\tvalue\tend');
  const first = page.locator('[data-column="0"]');
  const second = page.locator('[data-column="1"]');
  const third = page.locator('[data-column="2"]');
  await expect(first).toHaveAttribute('aria-label', '列1（same）の配置');
  await expect(second).toHaveAttribute('aria-label', '列2（空のヘッダー）の配置');
  await expect(third).toHaveAttribute('aria-label', '列3（same）の配置');
  await second.selectOption('center');
  await third.selectOption('right');
  await expect(output).toHaveValue(/:---:/);
  await expect(output).toHaveValue(/---:/);

  await input.fill('same\t\tsame\tnew\nshort\tvalue\tend\tx');
  await expect(page.locator('[data-column="1"]')).toHaveValue('center');
  await expect(page.locator('[data-column="2"]')).toHaveValue('right');
  await expect(page.locator('[data-column="3"]')).toHaveValue('none');
  await input.fill('same\t\t\nshort\tvalue\tx');
  await expect(page.locator('[data-column]')).toHaveCount(3);
  await expect(page.locator('[data-column="1"]')).toHaveValue('center');

  await input.fill('"unterminated');
  await expect(page.getByRole('alert')).toContainText('引用符');
  await expect(output).toHaveValue('');
  await page.locator('[data-column="1"]').selectOption('left');
  await expect(page.getByRole('alert')).toContainText('引用符');
  await expect(output).toHaveValue('');

  await page.getByRole('button', { name: '入力をクリア' }).click();
  await expect(page.locator('[data-column]')).toHaveCount(0);
  await expect(page.getByRole('alert')).toBeEmpty();
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
    await page.keyboard.press('ArrowRight');
    expect(await scroll.evaluate(element => element.scrollLeft)).toBeGreaterThan(0);
  }
});
