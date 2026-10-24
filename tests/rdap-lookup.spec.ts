import { test, expect } from './fixtures';
import { network } from '../src/tools/rdap-lookup/__tests__/fixture';

for (const ip of ['8.8.8.8', '2001:4860:4860::8888']) {
  test(`RDAP ${ip}：明示検索・JSON表示・コピー・非保存`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const requests: string[] = [];
    await page.route('https://rdap.org/**', route => {
      requests.push(route.request().url());
      return route.fulfill({ json: network });
    });
    await page.goto('./?tool=rdap-lookup');
    const input = page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' });
    await expect(input).toBeVisible();
    expect(requests).toEqual([]);
    await input.fill('invalid');
    await input.press('Enter');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(requests).toEqual([]);
    await input.fill(`  ${ip}  `);
    await input.press('Enter');
    await expect(page.getByText('検索が完了しました。', { exact: true })).toBeVisible();
    await expect(input).toHaveValue(ip);
    await expect(page.locator('[data-result]')).toContainText('Example Inc');
    await expect(page.locator('[data-result]')).toContainText('abuse@example.test');
    await expect(page.locator('[data-result]')).toContainText('最終更新日時');
    await expect(page.locator('pre')).toBeHidden();
    await page.getByText('元のRDAP JSON', { exact: true }).click();
    await expect(page.locator('pre')).toBeVisible();
    await page.getByRole('button', { name: 'JSONをコピー' }).click();
    await expect(page.getByText('コピーしました。', { exact: true })).toBeVisible();
    const json = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(json)).toEqual(network);
    expect(requests).toEqual([`https://rdap.org/ip/${encodeURIComponent(ip)}`]);
    expect(new URL(page.url()).search).toBe('?tool=rdap-lookup');
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state })))
      .toEqual({ local: {}, session: {}, state: null });
    await page.reload();
    await expect(input).toHaveValue('');
    expect(requests).toHaveLength(1);
  });
}
for (const version of ['IPv4', 'IPv6']) {
  test(`${version}確認からだけIPを引き継ぎ検索、戻る・進むでは再検索しない`, async ({ page }) => {
    const requests: string[] = [];
    await page.route('https://rdap.org/**', route => { requests.push(route.request().url()); return route.fulfill({ json: network }); });
    await page.goto('./?tool=ip-address');
    const ip = version === 'IPv4' ? '203.0.113.42' : '2001:db8::1';
    await page.getByRole('link', { name: `${version}の登録情報を検索`, exact: true }).click();
    await expect(page.getByText('検索が完了しました。', { exact: true })).toBeVisible();
    const input = page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' });
    await expect(input).toHaveValue(ip);
    await expect(page).toHaveURL(/\?tool=rdap-lookup$/);
    await page.goBack();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('IPアドレス確認');
    await page.goForward();
    await expect(input).toHaveValue('');
    expect(requests).toEqual([`https://rdap.org/ip/${encodeURIComponent(ip)}`]);
    await page.getByRole('link', { name: 'ホーム', exact: true }).click();
    await page.locator('.tool-card[data-tool-id=rdap-lookup]').click();
    await expect(input).toHaveValue('');
    expect(requests).toHaveLength(1);
  });
}
for (const status of [404, 429, 503, 'network'] as const) {
  test(`RDAPエラー ${status} と外部確認リンク、再検索で回復`, async ({ page }) => {
    await page.route('https://rdap.org/**', route => status === 'network' ? route.abort('failed') : route.fulfill({ status, body: '{}' }));
    await page.goto('./?tool=rdap-lookup');
    await page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' }).fill('8.8.8.8');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.locator('[role=alert]')).toContainText(status === 'network' ? '通信エラー' : `HTTP${status === 503 ? 'エラー' : ` ${status}`}`);
    await expect(page.getByRole('link', { name: 'RDAP.orgで外部確認する' })).toHaveAttribute('href', 'https://rdap.org/ip/8.8.8.8');
    await page.route('https://rdap.org/**', route => route.fulfill({ json: network }));
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.getByText('検索が完了しました。', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'RDAP.orgで外部確認する' })).toBeHidden();
  });
}
for (const theme of ['light', 'dark']) {
  test(`RDAP：320px ${theme}・安全な描画・キーボード操作`, async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 844 });
    await page.route('https://rdap.org/**', route => route.fulfill({ json: { ...network, name: '<img src=x onerror=alert(1)>', extension: 'x'.repeat(500) } }));
    await page.goto('./?tool=rdap-lookup');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const input = page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' });
    await input.fill('2001:4860:4860::8888');
    await input.press('Enter');
    await expect(page.getByText('検索が完了しました。', { exact: true })).toBeVisible();
    await expect(page.locator('[data-result]')).toContainText('<img src=x onerror=alert(1)>');
    await expect(page.locator('.rdap-tool img')).toHaveCount(0);
    const summary = page.locator('summary');
    await summary.focus();
    await expect(summary).toHaveCSS('outline-style', 'solid');
    await summary.press('Enter');
    await expect(page.locator('pre')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  });
}
