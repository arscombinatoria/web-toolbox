import { expect, test } from './fixtures';
import { network } from '../src/tools/rdap-lookup/__tests__/fixture';

const viewportWidths = [320, 375, 599, 600, 759, 760, 1024, 1280, 1440];
const longEmail = `${'abuse-contact-'.repeat(8)}team@example.test`;
const longOrganization = `Example ${'International Organization '.repeat(12)}`;
const longNetwork = {
  ...network,
  entities: [
    { roles: ['registrant'], vcardArray: ['vcard', [['org', {}, 'text', longOrganization]]] },
    { roles: ['abuse'], vcardArray: ['vcard', [['email', {}, 'text', longEmail]]] },
  ],
};

for (const theme of ['light', 'dark']) {
  test(`RDAP結果の実レイアウトと折り返し (${theme})`, async ({ page }) => {
    await page.route('https://rdap.org/**', route => route.fulfill({ json: longNetwork }));
    await page.setViewportSize({ width: 320, height: 1000 });
    await page.goto('./?tool=rdap-lookup');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const input = page.getByRole('textbox', { name: 'IPアドレス（IPv4・IPv6）' });
    await input.fill('2001:4860:4860::8888');
    await input.press('Enter');
    await expect(page.getByText('検索が完了しました。', { exact: true })).toBeVisible();

    const result = page.locator('[data-result]');
    const abuseLabel = result.locator('dt', { hasText: 'Abuse窓口のメールアドレス' });
    const abuseValue = result.locator('dd', { hasText: longEmail }).first();
    const orgValue = result.locator('dd', { hasText: longOrganization }).first();
    const ipv6Value = result.locator('dd', { hasText: '2001:4860:4860::8888' });
    await expect(abuseLabel).toBeVisible();
    await expect(abuseValue).toBeVisible();
    await expect(orgValue).toBeVisible();
    await expect(ipv6Value).toBeVisible();

    for (const width of viewportWidths) {
      await page.setViewportSize({ width, height: 1000 });
      const sidebar = page.locator('.sidebar');
      if (width >= 760) await expect(sidebar).toBeVisible();
      else await expect(sidebar).toBeHidden();
      const measurements = await page.evaluate(() => {
        const rangeRects = (element: Element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
            .map(({ left, right, top, bottom }) => ({ left, right, top, bottom }));
        };
        const wordRects = (element: Element) => {
          const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
          const rects = [];
          while (walker.nextNode()) {
            const node = walker.currentNode as Text;
            for (const match of node.data.matchAll(/\S+/g)) {
              const range = document.createRange();
              range.setStart(node, match.index);
              range.setEnd(node, match.index + match[0].length);
              rects.push(...[...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
                .map(({ left, right }) => ({ left, right })));
            }
          }
          return rects;
        };
        const tool = document.querySelector<HTMLElement>('.rdap-tool')!;
        const dls = [...tool.querySelectorAll<HTMLElement>('[data-result] dl')];
        const columns = dls.map(dl => {
          const dt = dl.querySelector<HTMLElement>('dt')!;
          const dd = dt.nextElementSibling as HTMLElement;
          return {
            labelLeft: dt.getBoundingClientRect().left,
            labelWidth: dt.getBoundingClientRect().width,
            valueLeft: dd.getBoundingClientRect().left,
            labelRectCount: rangeRects(dt).length,
          };
        });
        const overflow = [...tool.querySelectorAll<HTMLElement>('dd')].map(dd => {
          const bounds = dd.getBoundingClientRect();
          const textRects = wordRects(dd);
          return {
            scrolls: dd.scrollWidth > dd.clientWidth,
            textEscapes: textRects.some(rect => rect.left < bounds.left - 1 || rect.right > bounds.right + 1),
          };
        });
        return {
          toolWidth: tool.getBoundingClientRect().width,
          dls: columns,
          overflow,
          documentWidth: document.documentElement.scrollWidth,
          contentWidth: document.querySelector<HTMLElement>('.tool-content')!.scrollWidth,
          sidebarVisible: !document.querySelector<HTMLElement>('.sidebar')!.hidden,
        };
      });

      expect(measurements.documentWidth, `document overflow at ${width}px`).toBeLessThanOrEqual(width);
      expect(measurements.contentWidth, `content overflow at ${width}px`).toBeLessThanOrEqual(
        await page.locator('.tool-content').evaluate(element => element.clientWidth),
      );
      expect(measurements.sidebarVisible, `sidebar state at ${width}px`).toBe(width >= 760);
      expect(measurements.dls.length).toBeGreaterThan(1);
      expect(measurements.overflow.every(item => !item.scrolls && !item.textEscapes), `value overflow at ${width}px`).toBe(true);

      const twoColumns = measurements.toolWidth > 480;
      for (const dl of measurements.dls) {
        if (twoColumns) {
          expect(dl.valueLeft - dl.labelLeft, `column start at ${width}px`).toBeCloseTo(dl.labelWidth + 16, 0);
        } else {
          expect(dl.valueLeft - dl.labelLeft, `stacked columns at ${width}px`).toBeCloseTo(0, 0);
        }
      }
      if (twoColumns) {
        expect(new Set(measurements.dls.map(dl => Math.round(dl.labelWidth))).size, `label column widths at ${width}px`).toBe(1);
        expect(new Set(measurements.dls.map(dl => Math.round(dl.valueLeft))).size, `value starts at ${width}px`).toBe(1);
      }
      if (width >= 1024) {
        expect(measurements.dls.every(dl => dl.labelRectCount === 1), `all labels stay on one line at ${width}px`).toBe(true);
        await expect(abuseLabel.evaluate(element => {
          const range = document.createRange();
          range.selectNodeContents(element);
          return range.getClientRects().length;
        })).resolves.toBe(1);
      }
    }

    // コンテナクエリの切替点を幅480pxと481pxで実測する。
    const tool = page.locator('.rdap-tool');
    for (const [toolWidth, expectedStacked] of [[480, true], [481, false]] as const) {
      await tool.evaluate((element, width) => { (element as HTMLElement).style.width = `${width}px`; }, toolWidth);
      const coords = await page.locator('[data-result] dl').first().evaluate(dl => {
        const dt = dl.querySelector('dt')!.getBoundingClientRect();
        const dd = dl.querySelector('dd')!.getBoundingClientRect();
        return { toolWidth: dl.closest('.rdap-tool')!.getBoundingClientRect().width, labelLeft: dt.left, valueLeft: dd.left };
      });
      expect(coords.toolWidth).toBe(toolWidth);
      expect(Math.abs(coords.valueLeft - coords.labelLeft) < 1, `container boundary ${toolWidth}px`).toBe(expectedStacked);
    }
  });
}
