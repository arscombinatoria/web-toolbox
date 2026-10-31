import { expect, test } from './fixtures';

test('ホームのカード・選択状態・URL・履歴・再読み込みが本番サブパスで動く', async ({ page }) => {
  await page.goto('./?keep=yes');
  const heading = page.getByRole('heading', { level: 1 });
  const home = page.getByRole('link', { name: 'ホーム', exact: true });
  const brand = page.getByRole('link', { name: 'Web Toolbox', exact: true });
  await expect(heading).toHaveText('Web Toolbox');
  await expect(page).toHaveTitle('Web Toolbox');
  await expect(page.locator('.home').getByText('日々の作業を、少し手軽に。', { exact: true })).toBeVisible();
  await expect(page.getByText('ブラウザで使える、小さな便利ツール集です。', { exact: true })).toBeVisible();
  await expect(page.locator('.tool-card')).toHaveCount(7);
  await expect(home).toHaveAttribute('aria-current', 'page');
  const initialHistory = await page.evaluate(() => history.length);
  await home.click();
  expect(await page.evaluate(() => history.length)).toBe(initialHistory);
  for (const name of ['IPアドレス確認', 'IP登録情報検索', '全角・半角変換', 'Markdown表変換', '正規表現の可視化', '日時・UTC変換']) {
    const card = page.locator('.tool-card').filter({ has: page.getByRole('heading', { name, exact: true }) });
    await card.focus();
    await page.keyboard.press('Enter');
    await expect(heading).toHaveText(name);
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(`${name} | Web Toolbox`);
    await expect(page.getByRole('navigation').getByRole('link', { name, exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(home).not.toHaveAttribute('aria-current');
    await expect(page).toHaveURL(/keep=yes&tool=/);
    await brand.click();
    await expect(heading).toHaveText('Web Toolbox');
    await expect(heading).toBeFocused();
    await expect(page).toHaveURL(/\/web-toolbox\/\?keep=yes$/);
    await expect(home).toHaveAttribute('aria-current', 'page');
    await expect(page.getByRole('navigation').locator('[aria-current="page"]')).toHaveCount(1);
  }
  await page.goBack();
  await expect(heading).toHaveText('日時・UTC変換');
  await page.goForward();
  await expect(heading).toHaveText('Web Toolbox');
  await page.reload();
  await expect(heading).toHaveText('Web Toolbox');
  await page.goBack();
  await expect(heading).toHaveText('日時・UTC変換');
  await home.click();
  await expect(heading).toHaveText('Web Toolbox');
});

for (const id of ['ip-address', 'rdap-lookup', 'width-converter', 'markdown-table', 'datetime']) {
  test(`直接URLと再読み込み: ${id}`, async ({ page }) => {
    await page.goto(`./?tool=${id}`);
    const link = page.getByRole('navigation').locator(`[data-tool-id="${id}"]`);
    await expect(link).toHaveAttribute('aria-current', 'page');
    const name = await link.textContent();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name!);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(name!);
  });
}

for (const id of ['not-a-tool', '']) {
  test(`不正IDをホームに置き換えない: ${id}`, async ({ page }) => {
    await page.goto(`./?tool=${id}&keep=yes`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('ツールが見つかりません');
    await expect(page).toHaveTitle('ツールが見つかりません | Web Toolbox');
    await expect(page.getByRole('navigation').locator('[aria-current]')).toHaveCount(0);
    expect(new URL(page.url()).searchParams.get('tool')).toBe(id);
    await page.getByRole('link', { name: '既定のツールを開く' }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('IPアドレス確認');
    await page.getByRole('link', { name: 'ホーム', exact: true }).click();
    await expect(page).toHaveURL(/\?keep=yes$/);
  });
}

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
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Web Toolbox');
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
  await expect(dialog.getByRole('link', { name: 'ホーム', exact: true })).toBeFocused();
  // 最後のリンクからTabを押すとダイアログ内に戻る。
  await dialog.getByRole('link', { name: '日時・UTC変換', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('button', { name: '閉じる', exact: true })).toBeFocused();
  await page.keyboard.press('Shift+Tab');
  await expect(dialog.getByRole('link', { name: '日時・UTC変換', exact: true })).toBeFocused();
  // 境界以外では通常のTab順序を維持する。
  await dialog.getByRole('button', { name: '閉じる', exact: true }).focus();
  await page.keyboard.press('Tab');
  await expect(dialog.getByRole('link', { name: 'ホーム', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
  await expect(menu).toHaveAttribute('aria-expanded', 'false');
  await expect(menu).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Web Toolbox', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('combobox', { name: 'テーマ' })).toBeFocused();
  await menu.click();
  await dialog.getByRole('link', { name: '日時・UTC変換', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日時・UTC変換');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await menu.click();
  await expect(dialog.getByRole('link', { name: '日時・UTC変換', exact: true })).toHaveAttribute('aria-current', 'page');
  await dialog.getByRole('link', { name: 'ホーム', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Web Toolbox');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await menu.click();
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole('navigation')).toBeVisible();
  await expect(menu).toBeHidden();
});

test('ロード中にホームへ戻っても古いツールが画面・タイトル・フォーカスを奪わない', async ({ page }) => {
  await page.goto('./');
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  let requested!: (url: string) => void;
  const pending = new Promise<string>(resolve => { requested = resolve; });
  // ホーム起動後の動的JSだけを保留し、ビルドのハッシュやチャンク名に依存しない。
  await page.route('**/*.js', async route => {
    const response = await route.fetch();
    requested(route.request().url());
    await gate;
    await route.fulfill({ response });
  });
  try {
    await page.locator('.tool-card[data-tool-id="width-converter"]').click();
    const moduleUrl = await pending;
    await expect(page.getByText('読み込み中です…', { exact: true })).toBeVisible();
    await expect(page.locator('.tool-content')).toHaveAttribute('aria-busy', 'true');
    await expect(page).toHaveTitle('全角・半角変換 | Web Toolbox');
    await page.getByRole('link', { name: 'ホーム', exact: true }).click();
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText('Web Toolbox');
    await expect(heading).toBeFocused();
    const theme = page.getByRole('combobox', { name: 'テーマ' });
    await theme.focus();
    release();
    // 同じモジュールの評価完了を待ち、旧ロードの完了前に検証が終わるのを防ぐ。
    await page.evaluate(url => import(url), moduleUrl);
    await expect(heading).toHaveText('Web Toolbox');
    await expect(page).toHaveTitle('Web Toolbox');
    await expect(theme).toBeFocused();
    await expect(page.locator('.tool-content')).not.toHaveAttribute('aria-busy');
    await expect(page).toHaveURL(/\/web-toolbox\/$/);
    await page.locator('.tool-card[data-tool-id="width-converter"]').click();
    await expect(heading).toHaveText('全角・半角変換');
    await expect(heading).toBeFocused();
    await expect(page.getByRole('textbox', { name: '入力', exact: true })).toBeVisible();
  } finally {
    release();
    await page.unrouteAll({ behavior: 'wait' });
  }
});

test('同じツールの再選択では入力を保持して見出しへフォーカスを戻す', async ({ page }) => {
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('ＡＢＣ');
  const historyLength = await page.evaluate(() => history.length);
  await page.getByRole('navigation').getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await expect(input).toHaveValue('ＡＢＣ');
  await expect(page.getByRole('textbox', { name: '変換結果', exact: true })).toHaveValue('ABC');
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  expect(await page.evaluate(() => history.length)).toBe(historyLength);
});

test('ホームはアプリのチャンクだけを読み込み、外部通信を行わない', async ({ page }) => {
  const requests: string[] = [];
  page.on('request', request => requests.push(request.url()));
  await page.goto('./');
  await expect(page.locator('.tool-card')).toHaveCount(7);
  // load完了までの全通信を確認し、動的チャンクや外部リクエストがないことを検証する。
  await page.waitForLoadState('networkidle');
  expect(requests.every(url => new URL(url).origin === new URL(page.url()).origin)).toBe(true);
  const scripts = requests.filter(url => new URL(url).pathname.endsWith('.js'));
  expect(scripts).toHaveLength(1);
  expect(new URL(scripts[0]!).pathname).toMatch(/^\/web-toolbox\/assets\/index-[\w-]+\.js$/);
  await page.locator('.tool-card[data-tool-id="width-converter"]').click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('全角・半角変換');
  expect(requests.filter(url => new URL(url).pathname.endsWith('.js'))).toHaveLength(2);
});

for (const width of [1280, 390, 320]) {
  for (const theme of ['light', 'dark']) {
    test(`ホームの${width}px・${theme}表示とカード配置`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('./');
      await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
      const cards = page.locator('.tool-card');
      for (const card of await cards.all()) await expect(card).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      const first = await cards.nth(0).boundingBox();
      const second = await cards.nth(1).boundingBox();
      if (width >= 760) {
        expect(first!.y).toBe(second!.y);
        expect(second!.x).toBeGreaterThan(first!.x);
      } else {
        expect(first!.x).toBe(second!.x);
        expect(second!.y).toBeGreaterThan(first!.y);
      }
      await cards.first().focus();
      await expect(cards.first()).toHaveCSS('outline-style', 'solid');
    });
  }
}
