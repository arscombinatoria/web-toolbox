import { DEMO_SECRET, SAMPLE_JWT } from '../src/tools/jwt-debugger/sample';
import { SignJWT } from 'jose';
import { test, expect } from './fixtures';
const secret = 'test-only-secret-0123456789abcdef';

test('JWTの実検証・コピー・クリア・履歴・非通信・非保存', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?tool=jwt-debugger');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('JWTデバッガー');
  const token = await new SignJWT({ sub: '機密テスト😀', exp: 0, jku: 'https://example.com/key' }).setProtectedHeader({ alg: 'HS256', jku: 'https://example.com/key', kid: 'test' }).sign(new TextEncoder().encode(secret));
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  const logs: string[] = []; page.on('console', message => logs.push(message.text()));
  await page.getByLabel('JWT入力', { exact: true }).fill(token);
  await expect(page.locator('[data-verification]')).toHaveText('未検証');
  await expect(page.locator('[data-claims]')).toContainText('期限切れ');
  await page.getByLabel('共有Secret', { exact: true }).fill(secret);
  await expect(page.getByLabel('共有Secret', { exact: true })).toHaveAttribute('type', 'password');
  await page.getByRole('button', { name: 'Secretを表示', exact: true }).click();
  await expect(page.getByLabel('共有Secret', { exact: true })).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(page.locator('[data-verification]')).toHaveText('署名一致');
  await page.getByRole('button', { name: 'Payloadをコピー' }).click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toContain('機密テスト');
  await page.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error('denied')); });
  await page.getByRole('button', { name: 'Headerをコピー' }).click();
  await expect(page.locator('[data-copy-status]')).toContainText('手動');
  await expect(page.getByLabel('Header', { exact: true })).toHaveValue(/HS256/);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state, cookie: document.cookie })) ).toEqual({ local: {}, session: {}, state: null, cookie: '' });
  expect(page.url()).not.toContain(token);
  expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin && !url.includes(token) && !url.includes(secret))).toBe(true);
  expect(logs.join('')).not.toContain(secret); expect(logs.join('')).not.toContain(token);
  await page.getByLabel('共有Secret', { exact: true }).fill('wrong');
  await expect(page.locator('[data-verification]')).toHaveText('未検証');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(page.locator('[data-verification]')).toHaveText('署名不一致');
  await page.getByRole('button', { name: '入力をクリア' }).click();
  await expect(page.getByLabel('JWT入力', { exact: true })).toBeFocused();
  await expect(page.getByLabel('Payload', { exact: true })).toHaveValue('');
  await page.getByLabel('JWT入力', { exact: true }).fill(token);
  await page.reload(); await expect(page.getByLabel('JWT入力', { exact: true })).toHaveValue(SAMPLE_JWT);
  await expect(page.getByLabel('共有Secret', { exact: true })).toHaveValue(DEMO_SECRET);
  await page.getByLabel('JWT入力', { exact: true }).fill(token);
  await page.getByRole('link', { name: 'Web Toolbox', exact: true }).click();
  await page.goBack(); await expect(page.getByLabel('JWT入力', { exact: true })).toHaveValue(SAMPLE_JWT);
  await expect(page.getByLabel('共有Secret', { exact: true })).toHaveValue(DEMO_SECRET);
});
for (const theme of ['light', 'dark']) for (const width of [1280, 320]) {
  test(`JWT ${theme} ${width}px・キーボード`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./?tool=jwt-debugger');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await page.getByLabel('JWT入力', { exact: true }).fill('eyJhbGciOiJub25lIn0.eyJzdWIiOiI8c2NyaXB0PiJ9.');
    expect(await page.getByLabel('Payload', { exact: true }).inputValue()).toContain('<script>');
    const header = await page.getByLabel('Header', { exact: true }).boundingBox();
    const payload = await page.getByLabel('Payload', { exact: true }).boundingBox();
    if (width === 1280) expect(header!.y).toBe(payload!.y);
    else expect(payload!.y).toBeGreaterThan(header!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = page.getByRole('button', { name: '検証', exact: true });
    await button.focus(); await expect(button).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter'); await expect(page.locator('[data-verification]')).toContainText('検証不可');
  });
}

test('元のJSONの大きな整数と小数を表示・コピーする', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const source = '{"id":9223372036854775807,"tiny":1e-400,"fraction":0.1234567890123456789012345,"exp":100.00000000000000001}';
  const segment = Buffer.from(source).toString('base64url');
  await page.goto('./?tool=jwt-debugger');
  await page.getByLabel('JWT入力', { exact: true }).fill(`${segment}.${segment}.`);
  for (const part of ['Header', 'Payload']) {
    const output = await page.getByLabel(part, { exact: true }).inputValue();
    expect(output).toContain('9223372036854775807');
    expect(output).toContain('0.1234567890123456789012345');
    expect(output).toContain('1e-400');
    await page.getByRole('button', { name: `${part}をコピー`, exact: true }).click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(output);
  }
  await expect(page.locator('[data-claims]')).toContainText('数値精度');
});

test('初期サンプルの署名検証・Secret編集・クリア・ツール復帰', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('./?tool=jwt-debugger');
  const input = page.getByLabel('JWT入力', { exact: true });
  const key = page.getByLabel('共有Secret', { exact: true });
  await expect(input).toHaveValue(SAMPLE_JWT);
  await expect(key).toHaveValue(DEMO_SECRET);
  await expect(key).toHaveAttribute('type', 'password');
  await expect(page.getByLabel('検証アルゴリズム・キー種別')).toHaveValue('HS256');
  await expect(page.getByLabel('Secret形式')).toHaveValue('utf8');
  await expect(page.getByLabel('Header', { exact: true })).toHaveValue(/"typ": "JWT"/);
  await expect(page.getByLabel('Payload', { exact: true })).toHaveValue(/サンプルユーザー/);
  await expect(page.getByLabel('Signature（Base64URL）', { exact: true })).toHaveValue(SAMPLE_JWT.split('.')[2]!);
  await expect(page.locator('[data-claims]')).toContainText('UTC');
  await expect(page.locator('[data-claims]')).toContainText('JST');
  await expect(page.locator('[data-verification]')).toHaveText('未検証');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(page.locator('[data-verification]')).toHaveText('署名一致');
  await input.fill(`${SAMPLE_JWT} `); await expect(key).toHaveValue('');
  await key.fill('my-secret'); await input.fill(SAMPLE_JWT); await expect(key).toHaveValue('my-secret');
  await key.fill(DEMO_SECRET); await input.fill(`${SAMPLE_JWT} `); await expect(key).toHaveValue(DEMO_SECRET);
  await page.getByRole('button', { name: '入力をクリア' }).click();
  for (const label of ['JWT入力', '共有Secret', '公開鍵（SPKI PEM）', 'Header', 'Payload', 'Signature（Base64URL）']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await expect(page.locator('[data-claims]')).toBeEmpty();
  await expect(page.locator('[data-verification]')).toHaveText('未検証');
  await page.reload(); await expect(input).toHaveValue(SAMPLE_JWT);
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await page.getByRole('link', { name: 'JWTデバッガー', exact: true }).click();
  await expect(input).toHaveValue(SAMPLE_JWT); await expect(key).toHaveValue(DEMO_SECRET);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state, cookie: document.cookie }))).toEqual({ local: {}, session: {}, state: null, cookie: '' });
  expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin && !url.includes(SAMPLE_JWT) && !url.includes(DEMO_SECRET))).toBe(true);
});
