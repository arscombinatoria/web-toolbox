import { expect, test } from './fixtures';

test('初期設定・リアルタイム変換・方向と文字種の独立選択・クリア', async ({ page }) => {
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await expect(input).toHaveAttribute('placeholder', '例：ＡＢＣ　１２３');
  await expect(input).toHaveValue('');
  await expect(output).toHaveValue('');
  await expect(output).not.toHaveAttribute('placeholder');
  await expect(page.getByRole('group', { name: '変換方向' })).toBeVisible();
  await expect(page.getByRole('group', { name: '変換対象' })).toBeVisible();
  await expect(page.getByRole('radio', { name: '全角 → 半角' })).toBeChecked();
  await expect(page.getByText('0文字 / 0行', { exact: true })).toHaveCount(2);
  const swap = page.getByRole('button', { name: '入れ替え', exact: true });
  await expect(swap).toBeDisabled();
  for (const label of ['英数字', 'スペース']) await expect(page.getByRole('checkbox', { name: label })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: '記号' })).not.toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'カタカナ' })).not.toBeChecked();
  await input.fill('ＡＢＣ１２３！＠＃　ガギグ');
  await expect(page.locator('#width-input-count')).toHaveText('13文字 / 1行');
  await expect(page.locator('#width-output-count')).toHaveText('13文字 / 1行');
  await expect(output).toHaveValue('ABC123！＠＃ ガギグ');
  await expect(output).toHaveAttribute('readonly', '');
  await page.getByRole('checkbox', { name: '記号' }).check();
  await expect(output).toHaveValue('ABC123!@# ガギグ');
  await page.getByRole('checkbox', { name: 'カタカナ' }).check();
  await expect(output).toHaveValue('ABC123!@# ｶﾞｷﾞｸﾞ');
  await input.fill('ABC123! ｶﾞ①Ⅳ\n');
  await page.getByRole('radio', { name: '半角 → 全角' }).check();
  await expect(input).toHaveAttribute('placeholder', '例：ABC 123');
  await expect(output).toHaveValue('ＡＢＣ１２３！　ガ①Ⅳ\n');
  await expect(input).toHaveValue('ABC123! ｶﾞ①Ⅳ\n');
  await page.getByRole('checkbox', { name: '記号' }).uncheck();
  await expect(output).toHaveValue('ＡＢＣ１２３!　ガ①Ⅳ\n');
  await expect(page.locator('#width-output-count')).toHaveText('12文字 / 2行');
  for (const label of ['英数字', '記号', 'カタカナ', 'スペース']) await page.getByRole('checkbox', { name: label }).uncheck();
  await expect(output).toHaveValue('ABC123! ｶﾞ①Ⅳ\n');
  const clear = page.getByRole('button', { name: '入力をクリア', exact: true });
  await expect(clear.locator('svg')).toBeVisible();
  await clear.press('Enter');
  await expect(input).toHaveValue('');
  await expect(input).toHaveAttribute('placeholder', '例：ABC 123');
  await expect(output).toHaveValue('');
  await expect(page.locator('#width-input-count')).toHaveText('0文字 / 0行');
  await expect(page.locator('#width-output-count')).toHaveText('0文字 / 0行');
  await expect(swap).toBeDisabled();
  await expect(input).toBeFocused();
});

test('入れ替えは現在の条件を保ち、入力へフォーカスする', async ({ page }) => {
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  const swap = page.getByRole('button', { name: '入れ替え', exact: true });
  await page.getByRole('radio', { name: '半角 → 全角' }).check();
  await page.getByRole('checkbox', { name: 'カタカナ' }).check();
  await input.fill('ｶﾞ ABC');
  await expect(output).toHaveValue('ガ　ＡＢＣ');
  await swap.press('Enter');
  await expect(input).toHaveValue('ガ　ＡＢＣ');
  await expect(output).toHaveValue('ガ　ＡＢＣ');
  await expect(input).toBeFocused();
  await expect(page.getByRole('radio', { name: '半角 → 全角' })).toBeChecked();
  await expect(page.getByRole('checkbox', { name: 'カタカナ' })).toBeChecked();
  await page.getByRole('checkbox', { name: '英数字' }).uncheck();
  await expect(output).toHaveValue('ガ　ＡＢＣ');
  await page.getByRole('checkbox', { name: '英数字' }).check();
  await page.getByRole('radio', { name: '全角 → 半角' }).check();
  await expect(output).toHaveValue('ｶﾞ ABC');
});

test('コピー成功・失敗・手動選択・入力を保存や送信しない', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
      writeText: async (text: string) => { Object.assign(window, { copiedText: text }); },
    } });
  });
  const requests: string[] = [];
  page.on('request', request => { if (['fetch', 'xhr'].includes(request.resourceType())) requests.push(request.url()); });
  await page.goto('./?tool=width-converter');
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('ＡＢＣ１２３');
  const copy = page.getByRole('button', { name: '結果をコピー', exact: true });
  await expect(copy.locator('svg')).toBeVisible();
  const status = page.getByRole('status');
  const icon = status.locator('svg[aria-hidden="true"]');
  await copy.press('Space');
  await expect(status).toHaveText('コピーしました。');
  await expect(icon).toBeVisible();
  const successIcon = await icon.innerHTML();
  expect(await page.evaluate(() => Reflect.get(window, 'copiedText'))).toBe('ABC123');
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); });
  await copy.click();
  await expect(status).toContainText('コピーできませんでした');
  await expect(icon).toBeVisible();
  expect(await icon.innerHTML()).not.toBe(successIcon);
  await output.selectText();
  expect(await output.evaluate((element: HTMLTextAreaElement) => element.value.slice(element.selectionStart, element.selectionEnd))).toBe('ABC123');
  expect(requests).toEqual([]);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  await page.reload();
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
});

test('IMEイベント順序の差異と確定後の更新', async ({ page }) => {
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await input.fill('Ａ');
  const swap = page.getByRole('button', { name: '入れ替え', exact: true });
  await expect(swap).toBeEnabled();
  await input.dispatchEvent('compositionstart');
  await expect(swap).toBeDisabled();
  await input.evaluate((element: HTMLTextAreaElement) => { element.value = 'Ｂ'; element.dispatchEvent(new InputEvent('input', { bubbles: true, isComposing: true })); });
  await page.getByRole('checkbox', { name: 'カタカナ' }).check();
  await expect(output).toHaveValue('A');
  // 確定直前のisComposing=falseでもcompositionendまでは抑制する。
  await input.dispatchEvent('input', { isComposing: false });
  await expect(output).toHaveValue('A');
  await input.dispatchEvent('compositionend');
  await expect(swap).toBeEnabled();
  await expect(output).toHaveValue('B');
  await input.evaluate((element: HTMLTextAreaElement) => { element.value = 'Ｃ'; element.dispatchEvent(new InputEvent('input', { bubbles: true })); });
  await expect(output).toHaveValue('C');
  await expect(input).toHaveValue('Ｃ');
});

test('入れ替え前に開始したコピーの完了通知を破棄する', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => new Promise<void>(resolve => { Object.assign(window, { finishSwapCopy: resolve }); }) } });
  });
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('Ａ');
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await page.getByRole('button', { name: '入れ替え', exact: true }).click();
  await page.evaluate(() => Reflect.get(window, 'finishSwapCopy')());
  await expect(page.getByRole('status')).toBeEmpty();
});

test('保留中コピーの通知は入力変更後や破棄後に表示されない', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'clipboard', { value: { writeText: () => new Promise<void>(resolve => { Object.assign(window, { finishCopy: resolve }); }) } });
  });
  await page.goto('./?tool=width-converter');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('Ａ');
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('Ｂ');
  await page.evaluate(() => Reflect.get(window, 'finishCopy')());
  await expect(page.getByRole('button', { name: '結果をコピー' })).toBeEnabled();
  await expect(page.getByRole('status')).toBeEmpty();
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await page.getByRole('link', { name: '日時・UTC変換', exact: true }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('日時・UTC変換');
  await page.evaluate(() => Reflect.get(window, 'finishCopy')());
  await expect(page.getByText('コピーしました。', { exact: true })).toHaveCount(0);
  await page.goBack();
  await expect(page.getByRole('textbox', { name: '入力', exact: true })).toHaveValue('');
});

test('モバイル・ライト／ダーク・長い入力でも横にはみ出さない', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  const output = page.getByRole('textbox', { name: '変換結果', exact: true });
  await input.fill('Ａガ①'.repeat(10000));
  await expect(output).toHaveValue('Aガ①'.repeat(10000));
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await page.getByRole('checkbox', { name: 'カタカナ' }).check();
    await expect(output).toHaveValue('Aｶﾞ①'.repeat(10000));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const inputBox = (await input.boundingBox())!;
    const outputBox = (await output.boundingBox())!;
    expect(outputBox.y).toBeGreaterThan(inputBox.y + inputBox.height);
  }
});

test('320px・390px・デスクトップ幅でラベル・カウンター・操作が収まる', async ({ page }) => {
  await page.goto('./?tool=width-converter');
  const input = page.getByRole('textbox', { name: '入力', exact: true });
  await input.fill('😀ABC\n'.repeat(10));
  for (const width of [320, 390, 1280]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.locator('#width-input-count')).toHaveText('50文字 / 11行');
    await expect(page.getByRole('button', { name: '入れ替え', exact: true })).toBeVisible();
  }
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await expect(page.locator('.width-count').first()).toHaveCSS('color', /.+/);
  }
});

test('実Clipboard APIで変換結果をコピーできる', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.goto('./?tool=width-converter');
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('ＡＢＣ１２３！＠＃　ガギグ');
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await expect(page.getByRole('status')).toHaveText('コピーしました。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ABC123！＠＃ ガギグ');
  await page.getByRole('checkbox', { name: '記号' }).check();
  await page.getByRole('button', { name: '結果をコピー' }).click();
  await expect(page.getByRole('status')).toHaveText('コピーしました。');
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe('ABC123!@# ガギグ');
});
