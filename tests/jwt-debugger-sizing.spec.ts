import { expect, test } from '@playwright/test';

test('JWT各欄の自動高さ・リサイズ・幅・テーマに追従する', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await page.goto('./?tool=jwt-debugger');
  const input = page.locator('#jwt-input');
  const header = page.locator('#jwt-header');
  const payload = page.locator('#jwt-payload');
  const signature = page.locator('#jwt-signature');
  const fields = [input, header, payload, signature];
  const initialHeights = await Promise.all(fields.map(field => field.evaluate(element => element.clientHeight)));
  await expect(input).toHaveCSS('field-sizing', 'content');
  await expect(page.locator('#jwt-public')).toHaveCSS('field-sizing', 'fixed');
  await expect(page.locator('#jwt-public')).toHaveCSS('max-height', 'none');

  const compact = Buffer.from('{"sub":"x"}').toString('base64url');
  await input.fill(`e30.${compact}.`);
  for (const [index, field] of fields.entries()) {
    await expect.poll(() => field.evaluate(element => element.clientHeight)).toBeLessThan(initialHeights[index]!);
  }

  const beforeResize = await input.boundingBox();
  await page.mouse.move(beforeResize!.x + beforeResize!.width - 3, beforeResize!.y + beforeResize!.height - 3);
  await page.mouse.down();
  await page.mouse.move(beforeResize!.x + beforeResize!.width - 3, beforeResize!.y + beforeResize!.height + 28, { steps: 4 });
  await page.mouse.up();
  await expect.poll(() => input.evaluate(field => field.clientHeight)).toBeGreaterThan(beforeResize!.height - 2);
  await expect.poll(() => input.locator('..').locator('pre').evaluate(layer => layer.clientHeight))
    .toBe(await input.evaluate(field => field.clientHeight));

  const longHeader = Buffer.from(JSON.stringify({ alg: 'none', kid: 'h'.repeat(3000) })).toString('base64url');
  const longPayload = Buffer.from(JSON.stringify({ long: 'x'.repeat(12000) })).toString('base64url');
  await input.fill(`${longHeader}.${longPayload}.${'a'.repeat(5000)}`);
  const caps = ['192px', '288px', '384px', '144px'];
  for (const [index, field] of fields.entries()) {
    const cap = caps[index]!;
    await expect(field).toHaveCSS('max-height', cap);
    await expect.poll(() => field.evaluate(element => element.getBoundingClientRect().height)).toBe(Number.parseInt(cap, 10));
    await expect.poll(() => field.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  }
  for (const field of [input, header, payload]) {
    await field.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect.poll(() => field.evaluate(element => {
      const layer = element.parentElement!.querySelector('pre')!;
      return Math.abs(layer.scrollTop - element.scrollTop);
    })).toBeLessThanOrEqual(1);
    await expect(field.locator('..').locator('pre')).toHaveText(await field.inputValue());
  }
  await expect(header).toHaveValue(/none/);
  const beforeClear = await Promise.all(fields.map(field => field.evaluate(element => element.clientHeight)));
  for (const theme of ['light', 'dark']) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      const widths = await page.evaluate(() => ({ document: document.documentElement.scrollWidth, viewport: innerWidth }));
      expect(widths.document, `horizontal overflow at ${width}px: ${widths.document} > ${widths.viewport}`).toBeLessThanOrEqual(widths.viewport);
    }
  }
  await page.setViewportSize({ width: 320, height: 900 });
  await page.getByRole('button', { name: '入力をクリア' }).click();
  for (const [index, field] of fields.entries()) {
    await expect.poll(() => field.evaluate(element => element.clientHeight)).toBeLessThan(beforeClear[index]!);
  }
});
