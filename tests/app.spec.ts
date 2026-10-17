import { expect, test } from './fixtures';

test('Registryの4画面・URL・履歴・直接アクセスが本番サブパスで動く', async ({ page }) => {
  const loadedScripts: string[] = [];
  page.on('request', (request) => {
    if (request.resourceType() === 'script') loadedScripts.push(request.url());
  });
  await page.goto('./?keep=yes');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('IPアドレス確認');
  // 初回に選択されていないツールのチャンクを読み込まない。
  const initialCount = loadedScripts.length;
  expect(initialCount).toBeGreaterThanOrEqual(2);
  const initialHistory = await page.evaluate(() => history.length);
  await page.getByRole('link', { name: 'IPアドレス確認', exact: true }).click();
  expect(await page.evaluate(() => history.length)).toBe(initialHistory);
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('全角・半角変換');
  expect(loadedScripts.length).toBe(initialCount + 1);
  await expect(page).toHaveURL(/\/web-toolbox\/\?keep=yes&tool=width-converter$/);
  await expect(page.getByRole('link', { name: '全角・半角変換', exact: true })).toHaveAttribute('aria-current', 'page');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await page.getByRole('link', { name: 'Markdown表変換', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Markdown表変換');
  await page.getByRole('link', { name: '日時・UTC変換', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日時・UTC変換');
  await page.goBack();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Markdown表変換');
  await page.goForward();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日時・UTC変換');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日時・UTC変換');
  await expect(page.getByText('このツールは準備中です')).toBeVisible();
  await page.goto('./?tool=not-a-tool');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('ツールが見つかりません');
  await expect(page).toHaveURL(/tool=not-a-tool$/);
  await page.getByRole('link', { name: '既定のツールを開く' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('IPアドレス確認');
});

test('テーマのOS追従・手動保存・復元・システムへの復帰', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./');
  const theme = page.getByRole('combobox', { name: 'テーマ' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await theme.selectOption('light');
  await page.reload();
  await expect(theme).toHaveValue('light');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await theme.selectOption('system');
  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('web-toolbox-theme'))).toBeNull();
});

test('ストレージへのアクセスが拒否されても起動できる', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'localStorage', { get() { throw new Error('denied'); } });
  });
  await page.goto('./');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('IPアドレス確認');
  await page.getByRole('combobox', { name: 'テーマ' }).selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('モバイルメニューの開閉・フォーカス・選択・デスクトップ復帰', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  const menu = page.getByRole('button', { name: 'ツールメニューを開く' });
  const dialog = page.getByRole('dialog');
  await expect(page.getByRole('navigation')).toBeHidden();
  await menu.click();
  await expect(menu).toHaveAttribute('aria-expanded', 'true');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('link', { name: 'IPアドレス確認', exact: true })).toBeFocused();
  // 最後のリンクからTabを押すとダイアログ内に戻る。
  await dialog.getByRole('link', { name: '日時・UTC変換', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'テーマ' })).toBeFocused();
  await menu.click();
  await dialog.getByRole('link', { name: '日時・UTC変換', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日時・UTC変換');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await menu.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(menu).toBeHidden();
});
