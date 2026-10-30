import { readFile } from 'node:fs/promises';
import { expect, test } from './fixtures';

const sample = '^(?<word>[A-Za-z]+)(?:-[0-9]{2,4})?$';

test('入力・再描画・構文エラー・意味上の注意・フラグ排他・空入力', async ({ page }) => {
  await page.goto('./?tool=regex-visualizer');
  const input = page.getByRole('textbox', { name: '正規表現のパターン' });
  const image = page.getByRole('img', { name: '正規表現のRailroad Diagram' });
  const download = page.getByRole('button', { name: 'SVGをダウンロード' });
  await expect(input).toHaveValue(sample); await expect(download).toBeEnabled();
  const old = await image.getAttribute('src');
  await input.fill(' (?<名>日本語|😀)+?\\k<名> ');
  await page.getByRole('checkbox', { name: /^u：/ }).check();
  await expect(download).toBeEnabled(); await expect(image).not.toHaveAttribute('src', old!);
  await expect(page.getByRole('complementary', { name: '意味上の注意' })).toContainText('後方参照');
  await expect(page.getByRole('alert')).toBeEmpty();
  await input.fill('(');
  await expect(download).toBeDisabled(); await expect(image).toBeHidden();
  await expect(page.getByRole('alert')).toContainText('構文エラー');
  await expect(page.getByRole('alert')).toContainText('位置'); await expect(input).toHaveAttribute('aria-invalid', 'true');
  await input.fill('[\\p{Letter}&&\\p{ASCII}]');
  await page.getByRole('checkbox', { name: /^v：/ }).check();
  await expect(page.getByRole('checkbox', { name: /^u：/ })).not.toBeChecked();
  await expect(download).toBeEnabled(); await expect(page.getByRole('alert')).toBeEmpty();
  await page.getByRole('button', { name: '入力をクリア' }).click();
  await expect(input).toHaveValue(''); await expect(input).toBeFocused(); await expect(download).toBeEnabled();
});

test('SVGの実ダウンロード・単体表示・入力の非送信と非保存', async ({ page, context }) => {
  const external: string[] = [];
  page.on('request', request => { if (!request.url().startsWith('http://127.0.0.1:4173/') && !request.url().startsWith('blob:')) external.push(request.url()); });
  await page.goto('./?tool=regex-visualizer');
  const marker = 'private-pattern-123';
  await page.getByRole('textbox', { name: '正規表現のパターン' }).fill(`${marker}(?<=abc)[a-z]{2,4}?`);
  const button = page.getByRole('button', { name: 'SVGをダウンロード' }); await expect(button).toBeEnabled();
  const downloadEvent = page.waitForEvent('download'); await button.click(); const download = await downloadEvent;
  expect(download.suggestedFilename()).toBe('regex-diagram.svg');
  const svg = await readFile((await download.path())!, 'utf8');
  expect(svg).toContain(marker); expect(svg).toContain('0文字'); expect(svg).toContain('評価は右→左');
  const standalone = await context.newPage();
  await standalone.goto(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  await expect(standalone.locator('svg')).toBeVisible();
  expect(await standalone.locator('parsererror').count()).toBe(0); await standalone.close();
  expect(external).toEqual([]);
  expect(page.url()).not.toContain(marker);
  expect(await page.evaluate(() => [localStorage.length, sessionStorage.length])).toEqual([0, 0]);
  expect(await page.evaluate(() => JSON.stringify(history.state))).not.toContain(marker);
});

test('画面遷移・再読み込み・履歴で入力は復元せず、ホームは遅延読み込みを維持', async ({ page }) => {
  const scripts: string[] = []; page.on('request', request => { if (request.resourceType() === 'script') scripts.push(request.url()); });
  await page.goto('./'); expect(scripts.some(url => /regex-visualizer-|worker-/.test(url))).toBe(false);
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: '正規表現の可視化' }) }).click();
  await expect(page).toHaveURL(/tool=regex-visualizer/);
  const input = page.getByRole('textbox', { name: '正規表現のパターン' });
  await input.fill('private-input'); await expect(page.getByRole('button', { name: 'SVGをダウンロード' })).toBeEnabled();
  await page.reload(); await expect(input).toHaveValue(sample);
  await input.fill('discard-me'); await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await page.getByRole('textbox', { name: '入力', exact: true }).fill('Ａ');
  await expect(page.getByRole('textbox', { name: '変換結果' })).toHaveValue('A');
  await page.goBack(); await expect(input).toHaveValue(sample);
  await page.goBack(); await expect(page.getByRole('heading', { level: 1 })).toHaveText('Web Toolbox');
  await page.goForward(); await expect(input).toHaveValue(sample);
});

type WorkerTrace = { made: number; stopped: number; received: number; blobs: number; deliveries: (() => void)[] };

test('実Workerの古い結果は入力変更後・ツール破棄後に表示もBlob生成もしない', async ({ page }) => {
  await page.addInitScript(() => {
    const state: WorkerTrace = { made: 0, stopped: 0, received: 0, blobs: 0, deliveries: [] };
    const target = window as unknown as { regexTrace: WorkerTrace }; target.regexTrace = state;
    const NativeWorker = window.Worker;
    const originalCreate = URL.createObjectURL;
    URL.createObjectURL = function (blob) { state.blobs++; return originalCreate.call(URL, blob); };
    class ControlledWorker {
      native: Worker;
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;
      onmessageerror: (() => void) | null = null;
      constructor(url: string | URL, options?: WorkerOptions) {
        state.made++; this.native = new NativeWorker(url, options);
        this.native.onmessage = event => {
          state.received++; const callback = this.onmessage;
          state.deliveries.push(() => callback?.(event));
        };
        this.native.onerror = event => this.onerror?.(event);
        this.native.onmessageerror = () => this.onmessageerror?.();
      }
      postMessage(message: unknown) { this.native.postMessage(message); }
      terminate() { state.stopped++; this.native.terminate(); }
    }
    window.Worker = ControlledWorker as unknown as typeof Worker;
  });
  const count = () => page.evaluate(() => (window as unknown as { regexTrace: WorkerTrace }).regexTrace.received);
  const deliver = () => page.evaluate(() => (window as unknown as { regexTrace: WorkerTrace }).regexTrace.deliveries.shift()?.());
  await page.goto('./?tool=regex-visualizer');
  await expect.poll(count).toBe(1); await deliver();
  const input = page.getByRole('textbox', { name: '正規表現のパターン' });
  const download = page.getByRole('button', { name: 'SVGをダウンロード' }); await expect(download).toBeEnabled();
  await input.fill('old-result'); await expect.poll(count).toBe(2);
  await input.fill('latest-result');
  await deliver(); // すでにキューに入っていた古い結果をあえて配信
  await expect(page.locator('.regex-tool img')).toBeHidden(); await expect(download).toBeDisabled();
  await expect.poll(count).toBe(3); await deliver(); await expect(download).toBeEnabled();
  await input.fill('dispose-result'); await expect.poll(count).toBe(4);
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  const blobs = await page.evaluate(() => (window as unknown as { regexTrace: WorkerTrace }).regexTrace.blobs);
  await deliver();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('全角・半角変換');
  expect(await page.evaluate(() => (window as unknown as { regexTrace: WorkerTrace }).regexTrace.blobs)).toBe(blobs);
  expect(await page.evaluate(() => (window as unknown as { regexTrace: WorkerTrace }).regexTrace.stopped)).toBe(4);
  await expect(page.locator('.regex-tool')).toHaveCount(0);
});

for (const theme of ['light', 'dark']) {
  test(`モバイル・${theme}で図内スクロール・キーボード・巨大入力から回復`, async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 }); await page.goto('./?tool=regex-visualizer');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    const input = page.getByRole('textbox', { name: '正規表現のパターン' });
    await input.fill('(?<capture>[a-z]+)(?:foo|bar|baz){2,5}\\k<capture>');
    const button = page.getByRole('button', { name: 'SVGをダウンロード' }); await expect(button).toBeEnabled();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const canvas = page.getByRole('region', { name: /^正規表現の構造図/ });
    expect(await canvas.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
    await canvas.focus(); await expect(canvas).toBeFocused(); await page.keyboard.press('ArrowRight');
    await expect.poll(() => canvas.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
    expect(await page.locator('.regex-tool img').evaluate(node => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    await input.fill('a'.repeat(4097)); await expect(page.getByRole('alert')).toContainText('安全上限'); await expect(button).toBeDisabled();
    await input.fill('a{0}'); await expect(button).toBeEnabled(); await expect(page.getByRole('alert')).toBeEmpty();
  });
}
