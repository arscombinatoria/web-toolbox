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
  await expect(page.locator('[data-verification]')).toHaveAttribute('data-state', 'idle');
  await expect(page.locator('[data-claims]')).toContainText('期限切れ');
  await page.getByLabel('共有Secret', { exact: true }).fill(secret);
  await expect(page.getByLabel('共有Secret', { exact: true })).toHaveAttribute('type', 'text');
  await expect(page.locator('[data-reveal]')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Secretを(?:表示|隠す)/ })).toHaveCount(0);
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(page.locator('[data-verification]')).toHaveText('署名一致');
  await expect(page.locator('[data-verification]')).toHaveAttribute('data-state', 'match');
  await expect(page.locator('[data-verification-icon] svg')).toHaveCount(1);
  const payloadText = await page.getByLabel('Payload', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Payloadをコピー' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(payloadText);
  expect(payloadText).toContain('機密テスト');
  const headerText = await page.getByLabel('Header', { exact: true }).inputValue();
  await page.getByRole('button', { name: 'Headerをコピー' }).click();
  await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(headerText);
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
  await expect(page.locator('[data-verification]')).toHaveAttribute('data-state', 'idle');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(page.locator('[data-verification]')).toHaveText('署名不一致');
  await expect(page.locator('[data-verification]')).toHaveAttribute('data-state', 'mismatch');
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

test('署名バッジはforced-colorsでもアイコン・文言・状態属性を保つ', async ({ page }) => {
  await page.goto('./?tool=jwt-debugger');
  await page.emulateMedia({ forcedColors: 'active' });
  const badge = page.locator('[data-verification]');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(badge).toHaveAttribute('data-state', 'match');
  await expect(badge).toContainText('署名一致');
  await expect(page.locator('[data-verification-icon] svg')).toHaveCount(1);
  const matchColor = await badge.evaluate(element => getComputedStyle(element).color);
  const matchBackground = await badge.evaluate(element => getComputedStyle(element).backgroundColor);
  expect(matchColor).not.toBe(matchBackground);
  await page.getByLabel('共有Secret', { exact: true }).fill('wrong');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(badge).toHaveAttribute('data-state', 'mismatch');
  await expect(badge).toContainText('署名不一致');
  const mismatchColor = await badge.evaluate(element => getComputedStyle(element).color);
  expect(mismatchColor).toBe(matchColor);
  await expect(page.locator('[data-verification-icon] svg')).toHaveCount(1);
});
for (const theme of ['light', 'dark']) for (const [width, columns] of [[320, 1], [768, 1], [1280, 2], [1920, 2]] as const) {
  test(`JWT ${theme} ${width}px・キーボード`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('./?tool=jwt-debugger');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const workspace = page.locator('.jwt-workspace');
    const sourcePane = page.locator('.jwt-source');
    const decodedPane = page.locator('.jwt-decoded');
    const signature = page.locator('.jwt-signature');
    const claims = page.locator('.jwt-claims');
    await expect(page.locator('.jwt-tool > h1')).toHaveAttribute('tabindex', '-1');
    await expect(sourcePane.getByRole('heading', { name: 'Encoded JWT' })).toBeVisible();
    await expect(decodedPane.getByRole('heading', { name: 'Decoded' })).toBeVisible();
    await expect(page.locator('.jwt-tool')).toHaveCSS('container-type', 'inline-size');
    await expect(signature.getByRole('heading', { name: 'Signature（Base64URL）' })).toBeVisible();
    await expect(claims.getByRole('heading', { name: 'Claims・日時評価（署名とは独立）' })).toBeVisible();
    await expect(page.locator('.jwt-verification')).toBeVisible();
    expect(await workspace.locator(':scope > .jwt-source, :scope > .jwt-signature, :scope > .jwt-decoded').count()).toBe(3);
    expect(await page.locator('.jwt-source + .jwt-signature + .jwt-decoded').count()).toBe(1);
    expect(await page.locator('.jwt-workspace + .jwt-claims').count()).toBe(1);
    expect(await page.locator('.jwt-decoded .jwt-verification').count()).toBe(1);
    const panes = await Promise.all([sourcePane.boundingBox(), decodedPane.boundingBox()]);
    const signatureBox = await signature.boundingBox();
    const containerWidth = await workspace.evaluate(element => element.clientWidth);
    expect(containerWidth >= 832 ? 2 : 1).toBe(columns);
    const [workspaceBox, claimsBox] = await Promise.all([workspace.boundingBox(), claims.boundingBox()]);
    expect(Math.abs(claimsBox!.x - workspaceBox!.x)).toBeLessThanOrEqual(1);
    expect(Math.abs(claimsBox!.width - workspaceBox!.width)).toBeLessThanOrEqual(1);
    const claimsColumns = await claims.locator('[data-claims]').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length);
    expect(claimsColumns).toBe(containerWidth >= 832 ? 2 : 1);
    if (columns === 2) {
      expect(panes[0]!.x).toBeLessThan(panes[1]!.x);
      expect(Math.abs(panes[0]!.y - panes[1]!.y)).toBeLessThanOrEqual(1);
      expect(panes[0]!.x + panes[0]!.width).toBeLessThanOrEqual(panes[1]!.x);
      expect(signatureBox!.y).toBeGreaterThanOrEqual(panes[0]!.y + panes[0]!.height);
      expect(Math.abs(signatureBox!.x - panes[0]!.x)).toBeLessThanOrEqual(1);
      const sourceInput = await page.locator('#jwt-input').boundingBox();
      expect(sourceInput!.height).toBeGreaterThanOrEqual(80);
      expect(sourceInput!.height).toBeLessThanOrEqual(192);
      await expect(page.locator('#jwt-input')).toHaveCSS('field-sizing', 'content');
      await expect(page.locator('#jwt-input')).toHaveValue(SAMPLE_JWT);
    } else {
      expect(signatureBox!.y).toBeGreaterThanOrEqual(panes[0]!.y + panes[0]!.height);
      expect(panes[1]!.y).toBeGreaterThanOrEqual(signatureBox!.y + signatureBox!.height);
    }
    const verificationBox = await page.locator('.jwt-verification').boundingBox();
    const payloadBox = await page.locator('#jwt-payload').boundingBox();
    expect(verificationBox!.y).toBeGreaterThanOrEqual(payloadBox!.y + payloadBox!.height);
    await page.getByLabel('JWT入力', { exact: true }).fill('eyJhbGciOiJub25lIn0.eyJzdWIiOiI8c2NyaXB0PiJ9.');
    for (const id of ['input', 'header', 'payload']) {
      const field = page.locator(`#jwt-${id}`);
      await expect(field.locator('..')).toHaveClass(/jwt-highlight-active/);
      expect(await field.locator('..').locator('pre').textContent()).toBe(await field.inputValue());
    }
    expect(await page.getByLabel('Payload', { exact: true }).inputValue()).toContain('<script>');
    await expect(page.locator('[data-decode-state]')).toHaveAttribute('data-decode-state', 'success');
    const header = await page.getByLabel('Header', { exact: true }).boundingBox();
    const payload = await page.getByLabel('Payload', { exact: true }).boundingBox();
    expect(payload!.y).toBeGreaterThan(header!.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const button = page.getByRole('button', { name: '検証', exact: true });
    await button.focus(); await expect(button).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Enter'); await expect(page.locator('[data-verification]')).toContainText('検証不可');
    await expect(page.locator('[data-verification]')).toHaveAttribute('data-state', 'unavailable');
    await expect(page.locator('[data-verification-icon] svg')).toHaveCount(1);
    await expect(page.locator('[data-verification-detail]')).toContainText('非対応アルゴリズム');
  });
}

test('JWTレイアウトは同じ画面内の幅変更にも追従する', async ({ page }) => {
  await page.goto('./?tool=jwt-debugger');
  const workspace = page.locator('.jwt-workspace');
  const source = page.locator('.jwt-source');
  const decoded = page.locator('.jwt-decoded');
  const assertLayout = async (width: number, columns: number) => {
    await page.setViewportSize({ width, height: 900 });
    const measure = async () => {
      const [sourceBox, decodedBox] = await Promise.all([source.boundingBox(), decoded.boundingBox()]);
      const containerWidth = await workspace.evaluate(element => element.clientWidth);
      const actualColumns = containerWidth >= 832 ? 2 : 1;
      return { actualColumns, sourceBox, decodedBox };
    };
    await expect.poll(async () => (await measure()).actualColumns).toBe(columns);
    const { sourceBox, decodedBox } = await measure();
    if (columns === 2) {
      expect(decodedBox!.x).toBeGreaterThan(sourceBox!.x);
      expect(sourceBox!.x + sourceBox!.width).toBeLessThanOrEqual(decodedBox!.x);
      expect(Math.abs(sourceBox!.y - decodedBox!.y)).toBeLessThanOrEqual(1);
    } else {
      expect(decodedBox!.y).toBeGreaterThan(sourceBox!.y);
      expect(sourceBox!.y + sourceBox!.height).toBeLessThanOrEqual(decodedBox!.y);
    }
    const signatureBox = await page.locator('.jwt-signature').boundingBox();
    if (columns === 2) {
      expect(signatureBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height);
      expect(decodedBox!.y).toBeLessThan(signatureBox!.y);
    } else {
      expect(signatureBox!.y).toBeGreaterThanOrEqual(sourceBox!.y + sourceBox!.height);
      expect(decodedBox!.y).toBeGreaterThanOrEqual(signatureBox!.y + signatureBox!.height);
    }
    const verification = await page.locator('.jwt-verification').boundingBox();
    const payloadBox = await page.locator('#jwt-payload').boundingBox();
    expect(verification!.y).toBeGreaterThanOrEqual(payloadBox!.y + payloadBox!.height);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  };
  await assertLayout(320, 1);
  await assertLayout(1920, 2);
  await assertLayout(768, 1);
  await assertLayout(1280, 2);
});

test('長いIssuer・Audience・Unicode・日時Claimを全幅で折り返し、dt/ddを保つ', async ({ page }) => {
  const payload = Buffer.from(JSON.stringify({
    iss: '発行者😀'.repeat(900), aud: ['a'.repeat(9000)], exp: Math.floor(Date.now() / 1000) + 3600,
  })).toString('base64url');
  await page.goto('./?tool=jwt-debugger');
  await page.getByLabel('JWT入力', { exact: true }).fill(`e30.${payload}.`);
  for (const width of [320, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    const claims = page.locator('.jwt-claims');
    await expect(claims.locator('dl > .jwt-claim')).toHaveCount(7);
    for (const item of await claims.locator('dl > .jwt-claim').all()) {
      await expect(item.locator('dt')).toHaveCount(1);
      await expect(item.locator('dd')).toHaveCount(1);
      await expect.poll(() => item.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await expect.poll(() => item.locator('dd').evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    }
    await expect(claims.locator('[data-claims]')).toContainText('UTC');
    await expect(claims.locator('[data-claims]')).toContainText('JST');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('初期サンプルの署名検証・Secret編集・クリア・ツール復帰', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('./?tool=jwt-debugger');
  const input = page.getByLabel('JWT入力', { exact: true });
  const key = page.getByLabel('共有Secret', { exact: true });
  await expect(input).toHaveValue(SAMPLE_JWT);
  await expect(key).toHaveValue(DEMO_SECRET);
  await expect(key).toHaveAttribute('type', 'text');
  await expect(page.locator('[data-reveal]')).toHaveCount(0);
  await expect(page.getByLabel('検証アルゴリズム・キー種別')).toHaveValue('HS256');
  await expect(page.getByLabel('Secret形式')).toHaveValue('utf8');
  await expect(page.getByLabel('Header', { exact: true })).toHaveValue(/"typ": "JWT"/);
  await expect(page.getByLabel('Payload', { exact: true })).toHaveValue(/サンプルユーザー/);
  const signature = page.getByRole('textbox', { name: 'Signature（Base64URL）', exact: true });
  await expect(signature).toHaveAttribute('readonly', '');
  await expect(signature).toHaveValue(SAMPLE_JWT.split('.')[2]!);
  await expect(page.locator('[data-claims]')).toContainText('UTC');
  await expect(page.locator('[data-claims]')).toContainText('JST');
  await expect(page.locator('[data-verification]')).toHaveText('未検証');
  await page.getByRole('button', { name: '検証', exact: true }).click();
  await expect(page.locator('[data-verification]')).toHaveText('署名一致');
  await input.fill(`${SAMPLE_JWT} `); await expect(key).toHaveValue('');
  await key.fill('my-secret'); await input.fill(SAMPLE_JWT); await expect(key).toHaveValue('my-secret');
  await key.fill(DEMO_SECRET); await input.fill(`${SAMPLE_JWT} `); await expect(key).toHaveValue(DEMO_SECRET);
  await page.getByRole('button', { name: '入力をクリア' }).click();
  for (const label of ['JWT入力', '共有Secret', '公開鍵（SPKI PEM）', 'Header', 'Payload']) {
    await expect(page.getByLabel(label, { exact: true })).toHaveValue('');
  }
  await expect(page.getByRole('textbox', { name: 'Signature（Base64URL）', exact: true })).toHaveValue('');
  await expect(page.locator('[data-claims]')).toBeEmpty();
  await expect(page.locator('[data-verification]')).toHaveText('未検証');
  await page.reload(); await expect(input).toHaveValue(SAMPLE_JWT);
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await page.getByRole('link', { name: 'JWTデバッガー', exact: true }).click();
  await expect(input).toHaveValue(SAMPLE_JWT); await expect(key).toHaveValue(DEMO_SECRET);
  expect(await page.evaluate(() => ({ local: { ...localStorage }, session: { ...sessionStorage }, state: history.state, cookie: document.cookie }))).toEqual({ local: {}, session: {}, state: null, cookie: '' });
  expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin && !url.includes(SAMPLE_JWT) && !url.includes(DEMO_SECRET))).toBe(true);
});

for (const theme of ['light', 'dark']) {
  test(`ハイライトの色・元文字列・選択・Undo/Redo ${theme}`, async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.goto('./?tool=jwt-debugger');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const input = page.locator('#jwt-input');
    const wrapper = page.locator('.jwt-highlight').first();
    const layer = wrapper.locator('pre');
    await expect(wrapper).toHaveClass(/jwt-highlight-active/);
    await expect(layer).toHaveAttribute('aria-hidden', 'true');
    await expect(layer).toHaveCSS('pointer-events', 'none');
    expect(await layer.textContent()).toBe(SAMPLE_JWT);
    const colors = await layer.locator('span').evaluateAll(spans => spans.map(span => getComputedStyle(span).color));
    expect(new Set(colors).size).toBe(3);
    for (const id of ['header', 'payload']) {
      const field = page.locator(`#jwt-${id}`);
      expect(await field.locator('..').locator('pre').textContent()).toBe(await field.inputValue());
      await expect(field.locator('..').locator('.jwt-token-key').first()).toBeVisible();
    }
    const source = '{"nested":[{"text":"<img src=x onerror=alert(1)>日本語😀\\u65e5","bool":true,"nil":null}],"n":9223372036854775807,"f":1.2300e+10,"z":-0}';
    const segment = Buffer.from(source).toString('base64url');
    const token = `${segment}.${segment}.`;
    await input.fill(token);
    for (const id of ['header', 'payload']) {
      const field = page.locator(`#jwt-${id}`);
      const output = await field.inputValue();
      const jsonLayer = field.locator('..').locator('pre');
      expect(await jsonLayer.textContent()).toBe(output);
      for (const kind of ['key', 'string', 'number', 'literal']) await expect(jsonLayer.locator(`.jwt-token-${kind}`).first()).toBeVisible();
      expect(await jsonLayer.locator('img,script').count()).toBe(0);
      const contrasts = await jsonLayer.locator('span').evaluateAll(spans => {
        const luminance = (color: string) => {
          const [r, g, b] = color.match(/[\d.]+/g)!.slice(0, 3).map(value => {
            const channel = Number(value) / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
        };
        return spans.map(span => {
          const foreground = luminance(getComputedStyle(span).color);
          const background = luminance(getComputedStyle(span.closest('.jwt-highlight')!).backgroundColor);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
      });
      expect(contrasts.every(contrast => contrast >= 4.5)).toBe(true);
      await field.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
      expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(output);
    }
    await input.focus(); await expect(input).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+C');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(token);
    await page.keyboard.press('End'); await page.keyboard.type('x');
    await expect(input).toHaveValue(token + 'x');
    await page.keyboard.press('ControlOrMeta+Z'); await expect(input).toHaveValue(token);
    await page.keyboard.press('ControlOrMeta+Shift+Z'); await expect(input).toHaveValue(token + 'x');
    await page.keyboard.press('Backspace'); await expect(input).toHaveValue(token);
    await input.fill('a.b');
    expect(await layer.textContent()).toBe('a.b');
    await expect(wrapper).not.toHaveClass(/jwt-highlight-active/);
    await expect(page.locator('#jwt-payload').locator('..').locator('pre')).toBeEmpty();
    // Paste into the real textarea, using the browser clipboard.
    await page.evaluate(value => navigator.clipboard.writeText(value), SAMPLE_JWT);
    await input.focus(); await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.press('ControlOrMeta+V');
    await expect(input).toHaveValue(SAMPLE_JWT);
    expect(await layer.textContent()).toBe(SAMPLE_JWT);
    await page.getByRole('button', { name: '入力をクリア' }).click();
    await expect(layer).toBeEmpty();
  });
}

test('長いJWTの折り返し・スクロール・リサイズ・256KiBと描画上限', async ({ page }) => {
  await page.goto('./?tool=jwt-debugger');
  const input = page.locator('#jwt-input');
  const segment = Buffer.from('{"s":"' + 'a'.repeat(30000) + '"}').toString('base64url');
  await input.fill(`e30.${segment}.`);
  for (const width of [320, 768, 1280, 1920]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: 320, height: 900 });
  const dimensions = async () => input.evaluate(field => {
    const layer = field.parentElement!.querySelector('pre')!;
    return { width: field.clientWidth, scrollWidth: field.scrollWidth, height: field.clientHeight, scrollHeight: field.scrollHeight,
      layerWidth: layer.clientWidth, layerHeight: layer.clientHeight, layerScrollHeight: layer.scrollHeight,
      top: field.scrollTop, layerTop: layer.scrollTop, left: field.scrollLeft, layerLeft: layer.scrollLeft };
  });
  await expect.poll(async () => (await dimensions()).layerWidth).toBe((await dimensions()).width);
  let sizes = await dimensions();
  expect(sizes.scrollWidth).toBe(sizes.width);
  expect(Math.abs(sizes.layerScrollHeight - sizes.scrollHeight)).toBeLessThanOrEqual(1);
  expect(sizes.scrollHeight).toBeGreaterThan(sizes.height);
  await input.evaluate(field => { field.scrollTop = field.scrollHeight; });
  await expect.poll(async () => { const d = await dimensions(); return Math.abs(d.top - d.layerTop); }).toBeLessThanOrEqual(1);
  await input.evaluate(field => { field.style.height = '170px'; });
  await expect.poll(async () => (await dimensions()).layerHeight).toBe((await dimensions()).height);
  sizes = await dimensions(); expect(sizes.left).toBe(sizes.layerLeft);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  const source = '{"many":[' + '0,'.repeat(6000) + '0]}';
  const many = Buffer.from(source).toString('base64url');
  await input.fill(`e30.${many}.`);
  const payload = page.locator('#jwt-payload');
  await expect(payload).toHaveValue(/"many"/);
  await expect(payload.locator('..')).not.toHaveClass(/jwt-highlight-active/);
  expect(await payload.locator('..').locator('pre').textContent()).toBe(await payload.inputValue());
  await expect(page.getByRole('button', { name: '検証', exact: true })).toBeEnabled();
  const limit = 'e30.' + 'a'.repeat(256 * 1024 - 5) + '.';
  await input.fill(limit);
  expect(await input.inputValue()).toBe(limit);
  expect(await input.locator('..').locator('pre').textContent()).toBe(limit);
  await page.getByRole('button', { name: '入力をクリア' }).click();
  await expect(input).toHaveValue('');
});

test('IME変換中とforced-colorsではネイティブ文字表示へ戻す', async ({ page }) => {
  await page.goto('./?tool=jwt-debugger');
  const input = page.locator('#jwt-input');
  const wrapper = input.locator('..');
  await input.dispatchEvent('compositionstart');
  await input.fill('日本語');
  await expect(wrapper).not.toHaveClass(/jwt-highlight-active/);
  await expect(input).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await input.fill(SAMPLE_JWT);
  await input.dispatchEvent('compositionend');
  await expect(wrapper).toHaveClass(/jwt-highlight-active/);
  await page.emulateMedia({ forcedColors: 'active' });
  await expect(wrapper.locator('pre')).toHaveCSS('visibility', 'hidden');
  await expect(input).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
  await expect(input).toHaveValue(SAMPLE_JWT);
});
