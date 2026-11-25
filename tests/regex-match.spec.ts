import { expect, test } from './fixtures';

test('independent native Worker matches safely, preserves text, and stays local', async ({ page }) => {
  const external: string[] = [];
  const matchWorkerRequests: string[] = [];
  const appLogs: string[] = [];
  page.on('console', message => appLogs.push(message.text()));
  page.on('request', request => {
    const details = `${request.url()} ${request.postData() ?? ''}`;
    if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('blob:')) external.push(details);
    if (/match-worker-/.test(request.url())) matchWorkerRequests.push(request.url());
  });
  await page.setViewportSize({ width: 320, height: 844 });
  await page.goto('./?tool=regex-visualizer');
  const pattern = page.getByRole('textbox', { name: '正規表現のパターン' });
  const input = page.getByRole('textbox', { name: 'テスト文字列' });
  const section = page.locator('.regex-match-section');
  const run = page.getByRole('button', { name: 'マッチを確認' });
  const clear = page.getByRole('button', { name: 'テスト文字列をクリア' });
  const source = '<img src=x> foo-bar foo';
  const diagram = page.locator('.regex-diagram-section img');
  await expect(section.getByRole('status')).toHaveText('未実行');
  await expect(input).toHaveValue('');
  await pattern.fill('(?<word>foo)(?:-(bar))?');
  await page.getByRole('checkbox', { name: /^d：/ }).check();
  await page.getByRole('checkbox', { name: /^g：/ }).check();
  await expect(page.locator('.regex-diagram-section [role="status"]')).toHaveText('図を更新しました。');
  const diagramUrl = await diagram.getAttribute('src');
  await input.fill(source);
  await expect(diagram).toHaveAttribute('src', diagramUrl!);
  expect(matchWorkerRequests).toHaveLength(0);
  await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
  await expect(run).toBeDisabled();
  await input.evaluate(node => node.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
  await expect(run).toBeEnabled();
  await run.focus(); await page.keyboard.press('Enter');
  await expect(section.getByRole('status')).toHaveText('2件を確認しました。');
  expect(matchWorkerRequests.length).toBeGreaterThan(0);
  await expect(section.locator('.regex-match-highlight')).toHaveText(source);
  await expect(section.locator('mark')).toHaveCount(2);
  await expect(section.locator('.regex-match-list')).toContainText('UTF-16位置 12–19');
  const numbered = section.locator('details').first();
  await expect(numbered.locator('ul')).toHaveCount(0);
  await numbered.locator('summary').click();
  await expect(numbered).toContainText('捕捉 1: "foo"');
  await expect(numbered).toContainText('捕捉 2: "bar"');
  expect(await section.locator('.regex-match-highlight').evaluate(el => el.textContent)).toBe(source);
  await expect(section.locator('img')).toHaveCount(0);
  await expect(page).toHaveURL(/tool=regex-visualizer$/);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
  await expect(section.locator('mark').first()).toBeVisible();
  await pattern.fill('z+'); await input.fill(`${'q'.repeat(3_000)}${'z'.repeat(1_000)}`);
  await run.click(); await expect(section.getByRole('status')).toHaveText('1件を確認しました。');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 1280, height: 844 });
  await expect(section.locator('.regex-match-highlight')).toHaveText(`${'q'.repeat(3_000)}${'z'.repeat(1_000)}`);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const marker = '<img src=x>';
  const storedState = await page.evaluate(() => JSON.stringify({
    history: JSON.stringify(history.state),
    local: Object.values(localStorage).join(' '),
    session: Object.values(sessionStorage).join(' '),
    cookie: document.cookie,
  }));
  expect(storedState).not.toContain(marker);
  expect(appLogs.join('\n')).not.toContain(marker);
  expect(external).toEqual([]);
  await clear.click(); await expect(input).toHaveValue(''); await expect(input).toBeFocused();
  await expect(section.getByRole('status')).toHaveText('テスト文字列をクリアしました。');
  await pattern.fill('(?=😀)'); await page.getByRole('checkbox', { name: /^g：/ }).check();
  await page.getByRole('checkbox', { name: /^u：/ }).check(); await input.fill('a😀b'); await run.click();
  await expect(section.getByRole('status')).toHaveText('1件を確認しました。');
  await expect(section.locator('.regex-zero-width-marker')).toHaveCount(1);
  await expect(section.locator('.regex-match-highlight')).toHaveText('a😀b');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; });
});

test('cancels a heavy search responsively and recovers on the next explicit run', async ({ page }) => {
  await page.goto('./?tool=regex-visualizer');
  const pattern = page.getByRole('textbox', { name: '正規表現のパターン' });
  const input = page.getByRole('textbox', { name: 'テスト文字列' });
  const section = page.locator('.regex-match-section');
  const run = page.getByRole('button', { name: 'マッチを確認' });
  await pattern.fill('^(a+)+$'); await input.fill(`${'a'.repeat(30_000)}!`);
  // 図の描画やフォーカス移動でボタンの座標が変わっても、Enterでボタンを操作できる。
  await run.press('Enter');
  await expect(section.getByRole('status')).toHaveText('マッチ確認を実行しています。');
  await page.getByRole('button', { name: 'マッチングを中止' }).press('Enter');
  await expect(section.getByRole('status')).toHaveText('マッチ確認を停止しました。');
  await input.fill('aaa'); await pattern.fill('a+');
  await run.press('Enter');
  await expect(section.getByRole('status')).toHaveText('1件を確認しました。');
  await expect(section.locator('mark')).toHaveText('aaa');
});
