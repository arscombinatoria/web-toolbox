import { expect, test } from './fixtures';

for (const theme of ['light', 'dark']) {
  test(`IPv6欄が内容と画面幅に合わせて伸縮する (${theme})`, async ({ page }) => {
    const longIp = '2001:0db8:1234:5678:90ab:cdef:1234:5678';
    const embeddedIp = 'ffff:ffff:ffff:ffff:ffff:ffff:255.255.255.255';
    let requests = 0;
    await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '255.255.255.255' } }));
    await page.route('https://api6.ipify.org/**', (route) => {
      requests++;
      if (requests === 1) return route.fulfill({ json: { ip: longIp } });
      if (requests === 2) return route.fulfill({ json: { ip: embeddedIp } });
      if (requests === 3) return route.abort('failed');
      return route.fulfill({ json: { ip: '::1' } });
    });
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto('./?tool=ip-address');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const ipv4 = page.getByRole('textbox', { name: 'グローバルIPv4アドレス' });
    const ipv6 = page.getByRole('textbox', { name: 'グローバルIPv6アドレス' });
    const height = () => ipv6.evaluate((element) => element.getBoundingClientRect().height);
    const width = (element: typeof ipv6) => element.evaluate((node) => node.getBoundingClientRect().width);
    const stableWidth4 = await width(ipv4);
    const stableWidth6 = await width(ipv6);
    await expect(ipv4).toHaveValue('255.255.255.255');
    const expectFits = async () => {
      await expect.poll(() => ipv6.evaluate((element) => element.scrollHeight <= element.clientHeight)).toBe(true);
      await expect.poll(() => ipv6.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
    };
    await expect(ipv6).toHaveValue(longIp);
    const singleLineHeight = await height();
    expect(Math.abs(singleLineHeight - await ipv4.evaluate((element) => element.getBoundingClientRect().height))).toBeLessThanOrEqual(1);
    await expect(ipv6).toHaveAttribute('rows', '1');
    await expect(ipv6).toHaveAttribute('readonly', '');
    await expect(ipv6).toHaveCSS('resize', 'none');
    await expectFits();

    for (const viewportWidth of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width: viewportWidth, height: 1080 });
      await expectFits();
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(viewportWidth);
      if (viewportWidth === 1920) {
        const toolWidth = await page.locator('.ip-tool').evaluate((element) => element.getBoundingClientRect().width);
        expect(await width(ipv4)).toBeLessThan(toolWidth);
        expect(await width(ipv6)).toBeLessThan(toolWidth);
      }
    }

    await page.setViewportSize({ width: 320, height: 740 });
    const narrowWidth4 = await width(ipv4);
    const narrowWidth6 = await width(ipv6);
    const narrowSingleLineHeight = await ipv4.evaluate((element) => element.getBoundingClientRect().height);
    await expect.poll(height).toBeGreaterThan(narrowSingleLineHeight);
    await expectFits();
    const wrappedHeight = await height();
    expect(wrappedHeight).toBeGreaterThan(narrowSingleLineHeight);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(320);
    await ipv6.evaluate((element: HTMLTextAreaElement) => { element.focus(); element.select(); });
    expect(await ipv6.evaluate((element: HTMLTextAreaElement) =>
      element.value.slice(element.selectionStart, element.selectionEnd))).toBe(longIp);

    await page.setViewportSize({ width: 1920, height: 1080 });
    await expect.poll(height).toBe(singleLineHeight);
    await expectFits();
    await page.getByRole('button', { name: '再取得', exact: true }).click();
    await expect(ipv6).toHaveValue(embeddedIp);
    await expectFits();
    expect(await width(ipv4)).toBe(stableWidth4);
    expect(await width(ipv6)).toBe(stableWidth6);
    await page.setViewportSize({ width: 320, height: 740 });
    expect(await width(ipv4)).toBe(narrowWidth4);
    expect(await width(ipv6)).toBe(narrowWidth6);
    const embeddedWrappedHeight = await height();
    expect(embeddedWrappedHeight).toBeGreaterThan(narrowSingleLineHeight);
    await page.getByRole('button', { name: '再取得', exact: true }).click();
    await expect(page.getByRole('region', { name: 'グローバルIPv6アドレス' })
      .getByText('IPv6を利用できない環境、または一時的に取得できない状態です。')).toBeVisible();
    await expect(ipv6).toHaveValue('');
    await expect.poll(height).toBe(narrowSingleLineHeight);
    await expectFits();
    expect(await width(ipv4)).toBe(narrowWidth4);
    expect(await width(ipv6)).toBe(narrowWidth6);
    await page.getByRole('button', { name: '再取得', exact: true }).click();
    await expect(ipv6).toHaveValue('::1');
    await expectFits();
  });
}
