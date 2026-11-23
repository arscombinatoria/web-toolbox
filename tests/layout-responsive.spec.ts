import { expect, test } from './fixtures';

const pages = [
  { id: null, name: 'Web Toolbox' },
  { id: 'ip-address', name: 'IPアドレス確認' },
  { id: 'rdap-lookup', name: 'IP登録情報検索' },
  { id: 'width-converter', name: '全角・半角変換' },
  { id: 'markdown-table', name: 'Markdown表変換' },
  { id: 'regex-visualizer', name: 'JavaScript正規表現ビジュアライザー' },
  { id: 'jwt-debugger', name: 'JWTデバッガー' },
  { id: 'datetime', name: '日時・UTC変換' },
  { id: 'image-converter', name: '画像変換' },
] as const;

test('全ページが各幅・テーマで横にはみ出さず、サイドバー表示と本文の幅を保つ', async ({ page }) => {
  for (const entry of pages) {
    await page.setViewportSize({ width: 320, height: 900 });
    await page.goto(entry.id === null ? './' : `./?tool=${entry.id}`);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(entry.name);
    for (const width of [320, 768, 1280, 1920]) {
      await page.setViewportSize({ width, height: 900 });
      for (const theme of ['light', 'dark']) {
        await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
        const geometry = await page.evaluate(() => {
          const content = document.querySelector<HTMLElement>('.tool-content')!;
          const sidebar = document.querySelector<HTMLElement>('.sidebar-slot')!;
          const main = document.querySelector<HTMLElement>('main')!;
          return {
            viewport: document.documentElement.clientWidth,
            document: document.documentElement.scrollWidth,
            content: content.scrollWidth,
            contentClient: content.clientWidth,
            sidebarRight: sidebar.getBoundingClientRect().right,
            mainLeft: main.getBoundingClientRect().left,
            mainRight: main.getBoundingClientRect().right,
            mainWidth: main.getBoundingClientRect().width,
          };
        });
        expect(geometry.document, `${width}px ${theme} ${entry.name} document`).toBeLessThanOrEqual(geometry.viewport);
        expect(geometry.content, `${width}px ${theme} ${entry.name} content`).toBeLessThanOrEqual(geometry.contentClient);
        if (width > 759) {
          expect(geometry.mainLeft, `${width}px ${theme} ${entry.name} sidebar collision`).toBeGreaterThanOrEqual(geometry.sidebarRight);
          const leftGap = geometry.mainLeft - geometry.sidebarRight;
          const rightGap = geometry.viewport - geometry.mainRight;
          expect(Math.abs(leftGap - rightGap), `${width}px ${theme} ${entry.name} centering`).toBeLessThanOrEqual(1);
        }
        if (width === 1920) {
          expect(geometry.mainWidth, `${theme} ${entry.name} wider than previous 75rem cap`).toBeGreaterThan(1200);
        }
        if (entry.id === 'regex-visualizer' && width > 759) {
          const link = page.getByRole('navigation').getByRole('link', {
            name: `正規表現の可視化（${entry.name}）`, exact: true,
          });
          await expect(link.locator('.sidebar-label')).toHaveText('正規表現の可視化');
        }
      }
    }
  }
});
