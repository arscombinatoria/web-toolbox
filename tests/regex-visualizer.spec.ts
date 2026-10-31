import { readFile } from 'node:fs/promises';
import type { Locator } from '@playwright/test';
import { expect, test } from './fixtures';

const sample = '^([A-Za-z]+)(?:-[0-9]{2,4})?$';

async function settleScroll(canvas: Locator) {
  // キー操作のアニメーション終了を待ち、テーマ変更だけの影響を比較する。
  await canvas.evaluate(async node => {
    let previous = node.scrollLeft;
    let stable = 0;
    while (stable < 3) {
      await new Promise(requestAnimationFrame);
      const current = node.scrollLeft;
      stable = current === previous ? stable + 1 : 0;
      previous = current;
    }
  });
}

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
  await page.locator('.tool-card').filter({ has: page.getByRole('heading', { name: 'JavaScript正規表現ビジュアライザー' }) }).click();
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

for (const [width, theme] of [[320, 'light'], [320, 'dark'], [390, 'light'], [390, 'dark']] as const) {
  test(`モバイル${width}px・${theme}で図内スクロール・キーボード・巨大入力から回復`, async ({ page }) => {
    await page.setViewportSize({ width, height: 844 }); await page.goto('./?tool=regex-visualizer');
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
    await settleScroll(canvas);
    const before = await canvas.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight }));
    const oldUrl = await page.locator('.regex-tool img').getAttribute('src');
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme === 'light' ? 'dark' : 'light');
    await expect(page.locator('.regex-tool img')).not.toHaveAttribute('src', oldUrl!); await expect(button).toBeEnabled();
    expect(await canvas.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight }))).toEqual(before);
    await input.fill('a'.repeat(4097)); await expect(page.getByRole('alert')).toContainText('安全上限'); await expect(button).toBeDisabled();
    await input.fill('a{0}'); await expect(button).toBeEnabled(); await expect(page.getByRole('alert')).toBeEmpty();
  });
}

for (const width of [1280, 1440]) {
  for (const theme of ['light', 'dark']) {
    test(`デスクトップ${width}px・${theme}で初期図を収め、小さい図を中央に配置`, async ({ page }) => {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto('./?tool=regex-visualizer');
      await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
      const download = page.getByRole('button', { name: 'SVGをダウンロード' });
      await expect(download).toBeEnabled();
      const canvas = page.locator('.regex-canvas');
      const image = canvas.locator('img');
      expect(await canvas.evaluate(node => node.scrollWidth - node.clientWidth)).toBeLessThanOrEqual(1);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      expect(await image.evaluate(node => node.clientWidth / (node as HTMLImageElement).naturalWidth)).toBeGreaterThanOrEqual(0.79);
      await page.getByRole('textbox', { name: '正規表現のパターン' }).fill('a');
      await expect(download).toBeEnabled();
      const frame = (await canvas.boundingBox())!;
      const picture = (await image.boundingBox())!;
      expect(Math.abs(picture.x + picture.width / 2 - frame.x - frame.width / 2)).toBeLessThan(2);
      expect(picture.y).toBeGreaterThan(frame.y);
      // 幅の大きい式は、文字を際限なく縮めず、図の枠内で扱う。
      await page.getByRole('textbox', { name: '正規表現のパターン' }).fill('(abcdef)+'.repeat(12));
      await expect(download).toBeEnabled();
      expect(await canvas.evaluate(node => node.scrollWidth > node.clientWidth)).toBe(true);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await canvas.focus(); await page.keyboard.press('ArrowRight');
      await expect.poll(() => canvas.evaluate(node => node.scrollLeft)).toBeGreaterThan(0);
      await settleScroll(canvas);
      const before = await canvas.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight }));
      const oldUrl = await image.getAttribute('src');
      await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme === 'light' ? 'dark' : 'light');
      await expect(image).not.toHaveAttribute('src', oldUrl!); await expect(download).toBeEnabled();
      expect(await canvas.evaluate(node => ({ x: node.scrollLeft, y: node.scrollTop, width: node.scrollWidth, height: node.scrollHeight }))).toEqual(before);
    });
  }
}

test('ダウンロードSVG内のラベル・経路がviewBoxに収まる', async ({ page, context }) => {
  await page.goto('./?tool=regex-visualizer');
  await page.getByRole('textbox', { name: '正規表現のパターン' }).fill('(?<outer>(?:a?|b*|c+|d{2,4}?))(?<=xy)z{0}');
  const button = page.getByRole('button', { name: 'SVGをダウンロード' });
  await expect(button).toBeEnabled();
  const event = page.waitForEvent('download'); await button.click();
  const svg = await readFile((await (await event).path())!, 'utf8');
  const standalone = await context.newPage();
  await standalone.goto(`data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`);
  expect(await standalone.locator('svg').evaluate(root => {
    const svg = root as unknown as SVGSVGElement;
    const bounds = svg.viewBox.baseVal;
    const background = svg.querySelector<SVGRectElement>(':scope > .canvas-background')!;
    const backdrop = background.getBBox();
    if (backdrop.x !== 0 || backdrop.y !== 0 || backdrop.width !== bounds.width || backdrop.height !== bounds.height) return false;
    return [...svg.querySelectorAll<SVGGraphicsElement>('text, rect, path, circle')].filter(node => node !== background).every(node => {
      const box = node.getBBox();
      const matrix = svg.getCTM()!.inverse().multiply(node.getCTM()!);
      return [new DOMPoint(box.x, box.y), new DOMPoint(box.x + box.width, box.y + box.height)].every(point => {
        const p = point.matrixTransform(matrix);
        return p.x >= 1 && p.y >= 1 && p.x <= bounds.width - 1 && p.y <= bounds.height - 1;
      });
    });
  })).toBe(true);
  await standalone.close();
});

type ThemeTrace = { workers: number; posts: number; created: string[]; revoked: string[] };

test('テーマ変更は再解析せず、表示と保存SVGの配色・構造を維持し、破棄時にURLを解放する', async ({ page, context }) => {
  await page.addInitScript(() => {
    const trace: ThemeTrace = { workers: 0, posts: 0, created: [], revoked: [] };
    (window as unknown as { themeTrace: ThemeTrace }).themeTrace = trace;
    const NativeWorker = window.Worker;
    window.Worker = class extends NativeWorker {
      constructor(...args: ConstructorParameters<typeof Worker>) { super(...args); trace.workers++; }
      postMessage(message: unknown, options: Transferable[] | StructuredSerializeOptions = []) {
        trace.posts++;
        if (Array.isArray(options)) super.postMessage(message, options); else super.postMessage(message, options);
      }
    };
    const create = URL.createObjectURL; const revoke = URL.revokeObjectURL;
    URL.createObjectURL = blob => { const url = create.call(URL, blob); trace.created.push(url); return url; };
    URL.revokeObjectURL = url => { trace.revoked.push(url); revoke.call(URL, url); };
  });
  await page.goto('./?tool=regex-visualizer');
  const input = page.getByRole('textbox', { name: '正規表現のパターン' });
  await input.fill('(?<x>a+)?(?=b)\\k<x>');
  const download = page.getByRole('button', { name: 'SVGをダウンロード' });
  await expect(download).toBeEnabled();
  const initialTrace = await page.evaluate(() => (window as unknown as { themeTrace: ThemeTrace }).themeTrace);
  let structure: string | undefined;
  for (const theme of ['light', 'dark'] as const) {
    await page.getByRole('combobox', { name: 'テーマ' }).selectOption(theme);
    await expect(download).toBeEnabled();
    const displayed = await page.locator('.regex-canvas img').evaluate(async node => fetch((node as HTMLImageElement).src).then(response => response.text()));
    expect(displayed).toContain(`data-theme="${theme}"`);
    const stripped = displayed.replace(/ data-theme="(?:light|dark)"/, '');
    if (structure) expect(stripped).toBe(structure); else structure = stripped;
    const colors = await page.evaluate(() => {
      const css = getComputedStyle(document.documentElement);
      return Object.fromEntries(['page', 'surface', 'text', 'muted', 'border', 'accent', 'accent-soft'].map(token => [token, css.getPropertyValue(`--${token}`).trim()]));
    });
    expect(await page.locator('.regex-canvas').evaluate(node => getComputedStyle(node).backgroundColor)).toBe(theme === 'dark' ? 'rgb(19, 25, 34)' : 'rgb(248, 250, 252)');
    const event = page.waitForEvent('download'); await download.click();
    const saved = await readFile((await (await event).path())!, 'utf8');
    expect(saved).toBe(displayed);
    // 保存先のOSテーマが逆でも、保存時の配色を保つ。
    const standalone = await context.newPage();
    await standalone.emulateMedia({ colorScheme: theme === 'light' ? 'dark' : 'light' });
    await standalone.goto(`data:image/svg+xml;base64,${Buffer.from(saved).toString('base64')}`);
    expect(await standalone.locator('parsererror').count()).toBe(0);
    const actual = await standalone.locator('svg').evaluate((root, colors) => {
      const pairs = [
        ['.canvas-background', 'fill', 'page'], ['.literal text', 'fill', 'text'],
        ['path', 'stroke', 'muted'], ['.heading text', 'fill', 'muted'],
        ['.literal rect', 'fill', 'accent-soft'], ['.literal rect', 'stroke', 'accent'],
        ['.condition rect', 'fill', 'surface'], ['.group > rect', 'stroke', 'muted'],
      ];
      const probe = document.createElementNS('http://www.w3.org/2000/svg', 'rect'); root.append(probe);
      const matches = pairs.every(([selector, property, token]) => {
        probe.style.fill = colors[token!]!;
        return getComputedStyle(root.querySelector(selector!)!).getPropertyValue(property!) === getComputedStyle(probe).fill;
      });
      probe.remove();
      return { matches, condition: getComputedStyle(root.querySelector('.condition rect')!).strokeDasharray, reference: getComputedStyle(root.querySelector('.reference rect')!).strokeDasharray };
    }, colors);
    expect(actual).toEqual({ matches: true, condition: '5px, 3px', reference: '2px, 2px' });
    await expect(standalone.locator('svg')).toHaveAttribute('role', 'img');
    await expect(standalone.locator('title')).toHaveText('ECMAScript 正規表現の構造図');
    await expect(standalone.locator('desc')).toContainText('マッチングは実行しません');
    await standalone.close();
  }
  await page.evaluate(async () => {
    for (const theme of ['light', 'dark', 'light', 'dark']) {
      document.documentElement.dataset.theme = theme; await Promise.resolve();
    }
  });
  await expect(download).toBeEnabled();
  const finalSvg = await page.locator('.regex-canvas img').evaluate(async node => fetch((node as HTMLImageElement).src).then(response => response.text()));
  expect(finalSvg).toContain('data-theme="dark"');
  expect(finalSvg.replace(/ data-theme="(?:light|dark)"/, '')).toBe(structure);
  await expect(input).toHaveValue('(?<x>a+)?(?=b)\\k<x>');
  const trace = await page.evaluate(() => (window as unknown as { themeTrace: ThemeTrace }).themeTrace);
  expect(trace.workers).toBe(initialTrace.workers); expect(trace.posts).toBe(initialTrace.posts);
  await page.getByRole('link', { name: '全角・半角変換', exact: true }).click();
  await page.getByRole('combobox', { name: 'テーマ' }).selectOption('light');
  const disposed = await page.evaluate(() => (window as unknown as { themeTrace: ThemeTrace }).themeTrace);
  expect(disposed.created).toEqual(trace.created);
  expect(disposed.revoked.sort()).toEqual(disposed.created.sort());
});

test('システムテーマ変更でも保持したSVGだけを更新する', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'light' });
  await page.goto('./?tool=regex-visualizer');
  const button = page.getByRole('button', { name: 'SVGをダウンロード' }); await expect(button).toBeEnabled();
  await expect(page.getByRole('combobox', { name: 'テーマ' })).toHaveValue('system');
  const image = page.locator('.regex-canvas img');
  const first = await image.getAttribute('src');
  await page.emulateMedia({ colorScheme: 'dark' });
  await expect(image).not.toHaveAttribute('src', first!); await expect(button).toBeEnabled();
  expect(await image.evaluate(async node => fetch((node as HTMLImageElement).src).then(response => response.text()))).toContain('data-theme="dark"');
});
