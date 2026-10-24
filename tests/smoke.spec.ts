import { expect, test } from './fixtures';

test.use({ timezoneId: 'America/Los_Angeles' });

// 詳細な境界値・コピー・レイアウトは各ツールのspecで検証する。
test('スモーク: ホームからの遷移・履歴・直接URLの再読み込み', async ({ page }) => {
  await page.goto('./');
  const heading = page.getByRole('heading', { level: 1 });
  await expect(heading).toHaveText('Web Toolbox');
  await page.locator('.tool-card[data-tool-id="width-converter"]').click();
  await expect(heading).toHaveText('全角・半角変換');
  await expect(page.getByRole('navigation').getByRole('link', { name: '全角・半角変換', exact: true }))
    .toHaveAttribute('aria-current', 'page');
  await expect(page).toHaveURL(/\/web-toolbox\/\?tool=width-converter$/);
  await page.reload();
  await expect(heading).toHaveText('全角・半角変換');
  await page.goBack();
  await expect(heading).toHaveText('Web Toolbox');
  await page.goForward();
  await expect(heading).toHaveText('全角・半角変換');
  await page.getByRole('link', { name: 'ホーム', exact: true }).click();
  await expect(heading).toHaveText('Web Toolbox');
});

test('スモーク: IPv4・IPv6の表示と再取得', async ({ page }) => {
  await page.goto('./?tool=ip-address');
  const ipv4 = page.getByRole('textbox', { name: 'グローバルIPv4アドレス' });
  const ipv6 = page.getByRole('textbox', { name: 'グローバルIPv6アドレス' });
  await expect(ipv4).toHaveValue('203.0.113.42');
  await expect(ipv6).toHaveValue('2001:db8::1');
  await page.route('https://api.ipify.org/**', route => route.fulfill({ json: { ip: '198.51.100.7' } }));
  await page.route('https://api6.ipify.org/**', route => route.fulfill({ json: { ip: '2001:db8::2' } }));
  await page.getByRole('button', { name: '再取得', exact: true }).click();
  await expect(ipv4).toHaveValue('198.51.100.7');
  await expect(ipv6).toHaveValue('2001:db8::2');
});

test('スモーク: 文字種を選択して全角・半角を双方向に変換', async ({ page }) => {
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await input.fill('Ａ１！　ガ🙂');
  await expect(output).toHaveValue('A1! ガ🙂');
  await page.getByRole('checkbox', { name: 'カタカナ' }).check();
  await expect(output).toHaveValue('A1! ｶﾞ🙂');
  await page.getByRole('radio', { name: '半角 → 全角' }).check();
  await input.fill('A1! ｶﾞ🙂');
  await expect(output).toHaveValue('Ａ１！　ガ🙂');
});

test('スモーク: MarkdownとTSVの変換・不正入力からの復帰', async ({ page }) => {
  await page.goto('./?tool=markdown-table');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  const markdown = '| 品名 | 備考 |\n| --- | --- |\n| りんご | 青森<br>甘い |';
  const tsv = '品名\t備考\nりんご\t"青森\n甘い"';
  await input.fill(markdown);
  await expect(output).toHaveValue(tsv);
  await page.getByRole('radio', { name: 'Excel → Markdown' }).check();
  await input.fill('"unclosed');
  await expect(page.getByRole('alert')).toContainText('引用符');
  await expect(output).toHaveValue('');
  await input.fill(tsv);
  await expect(output).toHaveValue(markdown);
  await expect(page.getByRole('alert')).toBeEmpty();
});

test('スモーク: ローカルが米国時間でも日時入力と24時間表をJST・UTCで変換', async ({ page }) => {
  await page.goto('./?tool=datetime');
  await expect(page.locator('tbody tr')).toHaveCount(24);
  await page.getByLabel('対応表の日付（JST）').fill('2026-01-01');
  await page.getByRole('button', { name: 'JST 00:00を選択' }).click();
  await expect(page.getByLabel('詳細の日付')).toHaveValue('2026-01-01');
  await expect(page.getByLabel('UTC日時', { exact: true })).toHaveValue('2025-12-31 15:00:00');
  await page.getByLabel('入力タイムゾーン').selectOption('UTC');
  await page.getByLabel('詳細の日付').fill('1970-01-01');
  await page.getByLabel('詳細の時刻').fill('00:00:00');
  await expect(page.getByLabel('JST日時', { exact: true })).toHaveValue('1970-01-01 09:00:00');
  await expect(page.getByLabel('ISO 8601', { exact: true })).toHaveValue('1970-01-01T00:00:00Z');
  await expect(page.getByLabel('Unix time（秒）', { exact: true })).toHaveValue('0');
  await expect(page.getByLabel('Unix time（ミリ秒）', { exact: true })).toHaveValue('0');
});

test('スモーク: IP登録情報を明示検索し、JSONを表示する', async ({ page }) => {
  await page.goto('./?tool=rdap-lookup');
  const input = page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' });
  await expect(input).toHaveValue('');
  await expect(page.locator('[data-result]')).toBeHidden();
  await input.fill('2001:db8::1');
  await input.press('Enter');
  await expect(page.locator('[data-result]')).toContainText('MOCK-NETWORK');
  await page.getByText('元のRDAP JSON', { exact: true }).click();
  await expect(page.locator('pre')).toContainText('"objectClassName": "ip network"');
});
