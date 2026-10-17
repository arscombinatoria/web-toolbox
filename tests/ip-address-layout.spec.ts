import { expect, test } from './fixtures';

for (const theme of ['light', 'dark']) {
  test(`IPv6欄が内容と画面幅に合わせて伸縮する (${theme})`, async ({ page }) => {
    const longIp = '2001:0db8:1234:5678:90ab:cdef:1234:5678';
    let requests = 0;
    await page.route('https://api6.ipify.org/**', (route) => {
      requests++;
      return requests < 3
        ? route.fulfill({ json: { ip: requests === 1 ? longIp : '::1' } })
        : route.abort('failed');
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('./?tool=ip-address');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const ipv4 = page.getByRole('textbox', { name: 'グローバルIPv4アドレス' });
    const ipv6 = page.getByRole('textbox', { name: 'グローバルIPv6アドレス' });
    const height = () => ipv6.evaluate((element) => element.getBoundingClientRect().height);
    const expectFits = async () => {
      expect(await ipv6.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
      expect(await ipv6.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    };
    await expect(ipv6).toHaveValue(longIp);
    const singleLineHeight = await height();
    expect(Math.abs(singleLineHeight - await ipv4.evaluate((element) => element.getBoundingClientRect().height))).toBeLessThanOrEqual(1);
    await expect(ipv6).toHaveAttribute('rows', '1');
    await expect(ipv6).toHaveAttribute('readonly', '');
    await expect(ipv6).toHaveCSS('resize', 'none');
    await expectFits();

    await page.setViewportSize({ width: 320, height: 740 });
    const narrowSingleLineHeight = await ipv4.evaluate((element) => element.getBoundingClientRect().height);
    await expect.poll(height).toBeGreaterThan(narrowSingleLineHeight);
    await expectFits();
    const wrappedHeight = await height();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await ipv6.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.select(); });
    expect(await ipv6.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd))).toBe(longIp);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(height).toBe(singleLineHeight);
    await expectFits();
    await page.setViewportSize({ width: 320, height: 740 });
    await expect.poll(height).toBe(wrappedHeight);
    await page.getByRole('button', { name: '再取得', exact: true }).click();
    await expect(ipv6).toHaveValue('::1');
    await expect.poll(height).toBe(narrowSingleLineHeight);
    await expectFits();
    await page.getByRole('button', { name: '再取得', exact: true }).click();
    await expect(page.getByRole('region', { name: 'グローバルIPv6アドレス' }).getByText(/通信エラー：/)).toBeVisible();
    await expect(ipv6).toHaveValue('');
    await expectFits();
  });
}
