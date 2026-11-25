import { expect, test } from './fixtures';

test('日時の表と入力はロケール・端末タイムゾーンに依存せず、両表から選択できる', async ({ browser }) => {
  for (const locale of ['ja-JP', 'en-US']) {
    const context = await browser.newContext({ locale, timezoneId: 'Pacific/Kiritimati' });
    const page = await context.newPage();
    await page.clock.install({ time: new Date('2026-10-17T02:35:00Z') });
    await page.goto('./?tool=datetime');
    await expect(page.locator('[data-now-jst]')).toHaveText('2026-10-17 11:35');
    await expect(page.getByLabel('詳細の日付')).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('詳細の時刻')).toHaveAttribute('type', 'text');
    await expect(page.getByLabel('詳細の日付')).toHaveAttribute('placeholder', 'YYYY-MM-DD');
    await expect(page.getByLabel('詳細の時刻')).toHaveAttribute('placeholder', 'HH:mm:ss');
    await page.getByLabel('詳細の日付').fill('2026-10-17');
    await page.getByLabel('詳細の時刻').fill('09:30');
    await expect(page.getByLabel('ISO 8601', { exact: true })).toHaveValue('2026-10-17T00:30:00Z');

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.datetime-tables tbody').nth(0).locator('tr')).toHaveCount(12);
    await expect(page.locator('.datetime-tables tbody').nth(1).locator('tr')).toHaveCount(12);
    const columns = await page.locator('.datetime-tables').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(2);
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      expect(await page.locator('.datetime-tables').evaluate(el => getComputedStyle(el).gridTemplateColumns.split(' ').length)).toBe(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByLabel('対応表の日付（JST）').fill('2026-10-17');
    const earlier = page.getByRole('button', { name: 'JST 03:00を選択' });
    await earlier.focus();
    const startScroll = await page.evaluate(() => scrollY);
    await page.keyboard.press('Enter');
    await expect(page.getByLabel('詳細の時刻')).toHaveValue('03:00:00');
    expect(await page.evaluate(() => scrollY)).toBe(startScroll);
    await expect(earlier).toBeFocused();
    await page.getByRole('button', { name: 'JST 18:00を選択' }).click();
    await expect(page.getByLabel('詳細の日付')).toHaveValue('2026-10-17');
    await expect(page.getByLabel('詳細の時刻')).toHaveValue('18:00:00');
    await page.getByRole('button', { name: '詳細変換欄へ戻る' }).click();
    await expect(page.locator('#datetime-detail-title')).toBeFocused();
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption('dark');
    await expect(page.locator('.datetime-tables table')).toHaveCount(2);
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption('light');
    await context.close();
  }
});
