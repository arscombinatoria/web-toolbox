import { expect, test } from './fixtures';

test('IPの表示・再取得・実Clipboard APIによるコピー', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  let requests = 0;
  await page.route('https://api.ipify.org/**', (route) => {
    requests++;
    return route.fulfill({ json: { ip: requests === 1 ? '203.0.113.42' : '198.51.100.7' } });
  });
  await page.goto('./');
  const output = page.getByRole('textbox', { name: 'グローバルIPv4アドレス' });
  await expect(output).toHaveValue('203.0.113.42');
  await page.getByRole('button', { name: '再取得', exact: true }).click();
  await expect(output).toHaveValue('198.51.100.7');
  await page.getByRole('button', { name: 'コピーする' }).click();
  await expect(page.getByText('コピーしました。', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('198.51.100.7');
  expect(requests).toBe(2);
});

test('通信エラーから手動再取得できる', async ({ page }) => {
  let requests = 0;
  await page.route('https://api.ipify.org/**', (route) => ++requests === 1
    ? route.abort('failed') : route.fulfill({ json: { ip: '203.0.113.42' } }));
  await page.goto('./');
  await expect(page.getByText(/通信エラー：/)).toBeVisible();
  await expect(page.getByRole('button', { name: 'コピーする' })).toBeDisabled();
  await page.getByRole('button', { name: '再取得', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('203.0.113.42');
});

test('切り替え時に中止し、戻った画面に古い通信結果を表示しない', async ({ page }) => {
  let release!: () => void;
  let started!: () => void;
  let completed!: () => void;
  const oldRequestCompleted = new Promise<void>((resolve) => { completed = resolve; });
  const pending = new Promise<void>((resolve) => { release = resolve; });
  const firstRequest = new Promise<void>((resolve) => { started = resolve; });
  let requests = 0;
  await page.route('https://api.ipify.org/**', async (route) => {
    if (++requests === 1) {
      started();
      await pending;
      await route.fulfill({ json: { ip: '192.0.2.1' } }).catch(() => {});
      completed();
    } else await route.fulfill({ json: { ip: '198.51.100.7' } });
  });
  await page.goto('./');
  await firstRequest;
  const aborted = page.waitForEvent('requestfailed', (request) => request.url().startsWith('https://api.ipify.org/'));
  await page.getByRole('link', { name: '日時・UTC変換', exact: true }).click();
  await aborted;
  await expect(page.getByText('このツールは準備中です')).toBeVisible();
  await page.getByRole('link', { name: 'IPアドレス確認', exact: true }).click();
  await expect(page.getByRole('textbox')).toHaveValue('198.51.100.7');
  release();
  await oldRequestCompleted;
  await expect(page.getByRole('textbox')).toHaveValue('198.51.100.7');
});

for (const theme of ['light', 'dark']) {
  test(`320px・${theme}テーマでIPと操作を表示できる`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto('./');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await expect(page.getByRole('textbox')).toHaveValue('203.0.113.42');
    await expect(page.getByRole('button', { name: 'コピーする' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
  });
}
