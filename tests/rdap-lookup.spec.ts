import { test, expect } from './fixtures';
import { readFile } from 'node:fs/promises';
import { network } from '../src/tools/rdap-lookup/__tests__/fixture';

for (const ip of ['8.8.8.8', '2001:4860:4860::8888']) {
  test(`RDAP ${ip}：明示検索・JSON表示・コピー・非保存`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    const requests: string[] = [];
    await page.route('https://rdap.org/**', route => {
      requests.push(route.request().url());
      return route.fulfill({ json: network });
    });
    const ipifyRequests: string[] = [];
    await page.route('https://api*.ipify.org/**', route => { ipifyRequests.push(route.request().url()); return route.fulfill({ json: { ip } }); });
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
    await expect(page.getByText('JSONをコピーしました。', { exact: true })).toBeVisible();
    const json = await page.evaluate(() => navigator.clipboard.readText());
    expect(JSON.parse(json)).toEqual(network);
    expect(json).toBe(await page.locator('pre').textContent());
    await page.getByRole('button', { name: '結果をコピー' }).click();
    await expect(page.getByText('結果をコピーしました。', { exact: true })).toBeVisible();
    const copiedSummary = await page.evaluate(() => navigator.clipboard.readText());
    expect(copiedSummary).toContain(`IP登録情報検索（RDAP）\n検索対象: ${ip}`);
    expect(copiedSummary).toContain('■ ネットワーク情報');
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'JSONを保存' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe(`rdap-${ip.replaceAll(':', '-')}.json`);
    expect(await readFile(await download.path()!, 'utf8')).toBe(json);
    expect(requests).toEqual([`https://rdap.org/ip/${encodeURIComponent(ip)}`]);
    expect(new URL(page.url()).search).toBe('?tool=rdap-lookup');
    expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state })))
      .toEqual({ local: {}, session: {}, state: null });
    await page.reload();
    await expect(input).toHaveValue('');
    expect(requests).toHaveLength(1);
    expect(ipifyRequests).toEqual([]);
  });
}
for (const version of ['IPv4', 'IPv6']) {
  test(`${version}確認からだけIPを引き継ぎ検索、戻る・進むでは再検索しない`, async ({ page }) => {
    const requests: string[] = [];
    const ipifyRequests: string[] = [];
    await page.route('https://rdap.org/**', route => { requests.push(route.request().url()); return route.fulfill({ json: network }); });
    await page.route('https://api*.ipify.org/**', route => {
      if (new URL(page.url()).searchParams.get('tool') === 'rdap-lookup') ipifyRequests.push(route.request().url());
      return route.fallback();
    });
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
    expect(ipifyRequests).toEqual([]);
  });
}
for (const status of [404, 'network'] as const) {
  test(`RDAPエラー ${status} と外部確認リンク、再検索で回復`, async ({ page }) => {
    await page.route('https://rdap.org/**', route => status === 'network' ? route.abort('failed') : route.fulfill({ status, body: '{}' }));
    await page.goto('./?tool=rdap-lookup');
    await page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' }).fill('8.8.8.8');
    await page.getByRole('button', { name: '検索', exact: true }).click();
    await expect(page.locator('[role=alert]')).toContainText(status === 'network' ? '通信エラー' : 'HTTP 404');
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
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
  });
}

test('自分のIPv4／IPv6は明示クリックだけ通信し、取得後は検索しない', async ({ page }) => {
  const ipifyRequests: string[] = [];
  const rdapRequests: string[] = [];
  await page.route('https://api.ipify.org/**', route => { ipifyRequests.push(route.request().url()); return route.fulfill({ json: { ip: '203.0.113.42' } }); });
  await page.route('https://api6.ipify.org/**', route => { ipifyRequests.push(route.request().url()); return route.fulfill({ json: { ip: '2001:db8::1' } }); });
  await page.route('https://rdap.org/**', route => { rdapRequests.push(route.request().url()); return route.fulfill({ json: network }); });
  await page.goto('./?tool=rdap-lookup');
  expect(ipifyRequests).toEqual([]);
  const input = page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' });
  await page.getByRole('button', { name: '自分のIPv4' }).click();
  await expect(input).toHaveValue('203.0.113.42');
  expect(rdapRequests).toEqual([]);
  await page.getByRole('button', { name: '自分のIPv6' }).click();
  await expect(input).toHaveValue('2001:db8::1');
  expect(rdapRequests).toEqual([]);
  await page.getByRole('button', { name: 'クリア' }).click();
  await expect(input).toHaveValue('');
  expect(rdapRequests).toEqual([]);
  expect(ipifyRequests).toEqual(['https://api.ipify.org/?format=json', 'https://api6.ipify.org/?format=json']);
  await expect(input).toBeFocused();
});
