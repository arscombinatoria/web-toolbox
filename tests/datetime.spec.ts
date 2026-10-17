import { expect, test } from './fixtures';
test.use({ timezoneId: 'America/Los_Angeles' });
test.beforeEach(async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-17T05:35:00Z') });
  await page.goto('./?tool=datetime');
});
test('24時間表・今日・選択・秒精度・UTC入力・不正入力・切り替え', async ({ page }) => {
  await expect(page.locator('tbody tr')).toHaveCount(24);
  await expect(page.locator('[data-now-jst]')).toHaveText('2026-10-17 14:35');
  await expect(page.locator('.is-current')).toContainText('14:00');
  await page.getByLabel('対応表の日付（JST）').fill('2026-10-16');
  await expect(page.locator('.is-current')).toHaveCount(0);
  await page.getByLabel('対応表の日付（JST）').fill('');
  await expect(page.locator('#datetime-table-error')).toContainText('有効な年月日');
  await expect(page.locator('tbody tr')).toHaveCount(0);
  await page.getByRole('button', { name: '今日へ戻る' }).click();
  await expect(page.locator('.is-current')).toHaveCount(1);
  await page.getByRole('button', { name: 'JST 18:00を選択' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('詳細の日付')).toHaveValue('2026-10-17');
  await expect(page.getByLabel('詳細の時刻')).toHaveValue('18:00:00');
  await expect(page.getByLabel('UTC日時', { exact: true })).toHaveValue('2026-10-17 09:00:00');
  await expect(page.locator('.is-selected')).toContainText('選択中');
  await page.getByLabel('詳細の時刻').fill('09:30:45');
  await expect(page.getByLabel('ISO 8601', { exact: true })).toHaveValue('2026-10-17T00:30:45Z');
  await page.getByLabel('入力タイムゾーン').selectOption('UTC');
  await expect(page.getByLabel('JST日時', { exact: true })).toHaveValue('2026-10-17 18:30:45');
  await expect(page.getByLabel('対応表の日付（JST）')).toHaveValue('2026-10-17');
  await page.getByLabel('詳細の日付').fill('');
  await expect(page.locator('#datetime-error')).toContainText('有効な年月日');
  await expect(page.getByLabel('ISO 8601', { exact: true })).toHaveValue('');
  await expect(page.getByRole('button', { name: 'ISO 8601をコピー' })).toBeDisabled();
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await page.clock.fastForward(120000);
  await expect(page.locator('.datetime-tool')).toHaveCount(0);
  await page.goBack();
  await expect(page.locator('[data-now-jst]')).toHaveText('2026-10-17 14:37');
});
test('各形式のコピー・失敗時の手動選択', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  for (const label of ['JST日時', 'UTC日時', 'ISO 8601', 'Unix time（秒）', 'Unix time（ミリ秒）']) {
    const value = await page.getByLabel(label, { exact: true }).inputValue();
    await page.getByRole('button', { name: `${label}をコピー`, exact: true }).click();
    await expect(page.getByRole('status')).toContainText('コピーしました');
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(value);
  }
  await page.evaluate(() => { Object.defineProperty(navigator, 'clipboard', { value: undefined }); });
  await page.getByRole('button', { name: 'ISO 8601をコピー' }).click();
  await expect(page.getByRole('status')).toContainText('手動でコピー');
  await expect(page.getByLabel('ISO 8601', { exact: true })).toHaveAttribute('readonly', '');
});
test('モバイル・両テーマ・時間帯更新', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await expect(page.locator('table')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    expect(await page.locator('.is-current').evaluate(el => getComputedStyle(el).backgroundColor)).not.toBe('rgba(0, 0, 0, 0)');
  }
  await page.clock.fastForward(30 * 60000);
  await expect(page.locator('.is-current')).toContainText('15:00');
});
