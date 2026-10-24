import { test as base, expect } from '@playwright/test';

// 基盤のテストも実APIへアクセスさせない。各シナリオで必要なら上書きする。
export const test = base.extend({
  page: async ({ page }, use) => {
    await page.route('https://api.ipify.org/**', (route) => route.fulfill({ json: { ip: '203.0.113.42' } }));
    await page.route('https://api6.ipify.org/**', (route) => route.fulfill({ json: { ip: '2001:db8::1' } }));
    await page.route('https://rdap.org/**', (route) => route.fulfill({ json: { objectClassName: 'ip network', name: 'MOCK-NETWORK' } }));
    await use(page);
  },
});
export { expect };
