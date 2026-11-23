import { readFile } from 'node:fs/promises';
import type { FileChooser, Locator, Page } from '@playwright/test';
import { expect, test } from './fixtures';

async function testImage(page: Page, width = 64, height = 32) {
  const png = await page.evaluate(({ width, height }) => {
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'red';
    ctx.fillRect(width / 2, 0, width / 2, height);
    return canvas.toDataURL().split(',')[1]!;
  }, { width, height });
  return { name: 'sample.alpha.png', mimeType: 'image/png', buffer: Buffer.from(png, 'base64') };
}

async function pauseUiClock(page: Page) {
  const start = new Date('2026-01-01T00:00:00Z');
  await page.clock.install({ time: start });
  await page.clock.pauseAt(new Date(start.getTime() + 1000));
}

async function saveImage(page: Page, button: Locator, filename: string) {
  await expect(button).toBeEnabled();
  const downloading = page.waitForEvent('download');
  await button.click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe(filename);
  return readFile((await download.path())!);
}

async function firstPixel(preview: Locator) {
  return preview.evaluate(img => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;
    ctx.drawImage(img as HTMLImageElement, 0, 0);
    return [...ctx.getImageData(0, 0, 1, 1).data];
  });
}

test('SSIMULACRA2の目安表はクリック・Enterで開き、狭い画面にも収まる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  const guide = page.locator('.image-score-guide');
  const summary = guide.getByText('スコアの目安を見る', { exact: true });

  await expect(guide).not.toHaveAttribute('open', '');
  await summary.click();
  await expect(guide).toHaveAttribute('open', '');
  await expect(guide.getByRole('row')).toHaveCount(10);
  await expect(guide.getByRole('link', { name: 'SSIMULACRA2公式の使用方法' })).toHaveAttribute('href', 'https://github.com/cloudinary/ssimulacra2#usage');
  await summary.press('Enter');
  await expect(guide).not.toHaveAttribute('open', '');
  await summary.press('Enter');
  await expect(guide).toHaveAttribute('open', '');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('画像を選択し、比較線と左右のエンコーダーを操作して個別に保存する', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  const picker = page.waitForEvent('filechooser');
  await page.getByRole('button', { name: /画像を選択/ }).press('Space');
  await (await picker).setFiles(image);
  await expect(page.getByRole('button', { name: '画像を変更' })).toBeFocused();
  const saveLeft = page.getByRole('button', { name: '左をダウンロード' });
  const saveRight = page.getByRole('button', { name: '右をダウンロード' });
  const previewLeft = page.getByAltText('左側のプレビュー');
  const previewRight = page.getByAltText('右側のプレビュー');
  const formatLeft = page.getByLabel('左の形式');
  const formatRight = page.getByLabel('右の形式');
  const qualityLeft = page.getByRole('slider', { name: '左のJPEG品質' });
  const qualityRight = page.getByRole('slider', { name: '右のJPEG品質' });
  const leftPanel = page.getByRole('group', { name: '左の設定' });
  const rightPanel = page.getByRole('group', { name: '右の設定' });

  await expect(saveLeft).toBeEnabled();
  await expect(saveRight).toBeEnabled();
  await expect(formatLeft).toHaveValue('original');
  await expect(formatRight).toHaveValue('image/jpeg');
  await expect(qualityRight).toHaveValue('0.75');
  await expect(qualityLeft).toBeHidden();
  await expect(page.getByRole('img', { name: '元画像のプレビュー' })).toBeVisible();
  await expect(previewRight).toBeVisible();
  await expect(page.locator('.image-info')).toContainText('64 × 32 px');
  await expect(leftPanel.getByRole('status')).toHaveText(/元ファイル比 0%/);
  const leftBounds = (await leftPanel.boundingBox())!;
  const rightBounds = (await rightPanel.boundingBox())!;
  expect(leftBounds.y).toBe(rightBounds.y);
  expect(leftBounds.x + leftBounds.width).toBeLessThan(rightBounds.x);

  const split = page.getByRole('slider', { name: '比較位置' });
  const initialUrl = await previewRight.getAttribute('src');
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  await split.press('ArrowRight');
  await expect(split).toHaveAttribute('aria-valuenow', '51');
  await expect(split).toHaveAttribute('aria-valuetext', '左側 51%');
  await expect(page.locator('.image-position-control')).toHaveCount(0);
  await page.locator('.image-stage').scrollIntoViewIfNeeded();
  const bounds = (await split.boundingBox())!;
  const stageBounds = (await page.locator('.image-stage').boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(stageBounds.x - 10, bounds.y + bounds.height / 2);
  await page.mouse.up();
  expect(Number(await split.getAttribute('aria-valuenow'))).toBeLessThan(30);
  await expect(previewRight).toHaveAttribute('src', initialUrl!);

  await formatLeft.selectOption('image/jpeg');
  await qualityLeft.fill('0.35');
  await qualityRight.press('ArrowLeft');
  await expect(qualityRight).toHaveValue('0.74');
  await expect(qualityLeft).toHaveValue('0.35');
  await expect(saveRight).toBeEnabled();
  await expect(previewRight).not.toHaveAttribute('src', initialUrl!);
  const leftJpeg = await saveImage(page, saveLeft, 'sample.alpha-left-q0.35.jpg');
  const rightJpeg = await saveImage(page, saveRight, 'sample.alpha-right-q0.74.jpg');
  expect([...leftJpeg.subarray(0, 3)]).toEqual([255, 216, 255]);
  expect([...rightJpeg.subarray(0, 3)]).toEqual([255, 216, 255]);

  await formatRight.selectOption('image/png');
  await expect(qualityRight).toBeHidden();
  const png = await saveImage(page, saveRight, 'sample.alpha-right.png');
  expect([...png.subarray(0, 3)]).toEqual([137, 80, 78]);
  const percentFormat = new Intl.NumberFormat('ja-JP', { signDisplay: 'exceptZero', maximumFractionDigits: 2 });
  const formatFileSize = (bytes: number) => {
    if (bytes < 1_000) return `${new Intl.NumberFormat('ja-JP').format(bytes)} B`;
    const unit = bytes < 1_000_000 ? 'KB' : 'MB';
    const divisor = unit === 'KB' ? 1_000 : 1_000_000;
    return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: 2 }).format(bytes / divisor)} ${unit}`;
  };
  for (const [panel, bytes] of [[leftPanel, leftJpeg], [rightPanel, png]] as const) {
    const percent = (bytes.length - image.buffer.length) / image.buffer.length * 100;
    await expect(panel.getByRole('status')).toHaveText(
      `出力サイズ ${formatFileSize(bytes.length)}（元ファイル比 ${percentFormat.format(percent)}%）`,
    );
  }
  await expect(page.getByText('左右比較', { exact: false })).toHaveCount(0);
  await expect(page.locator('.image-comparison')).toHaveCount(0);
  expect((await firstPixel(previewRight))[3]).toBe(0);
  expect(Math.min(...await firstPixel(previewLeft))).toBeGreaterThan(245);

  await formatLeft.selectOption('image/png');
  await expect(qualityLeft).toBeHidden();
  await formatRight.selectOption('image/jpeg');
  await expect(qualityRight).toHaveValue('0.74');
  await expect(saveLeft).toBeEnabled();
  await expect(saveRight).toBeEnabled();
  expect((await firstPixel(previewLeft))[3]).toBe(0);
  expect(Math.min(...await firstPixel(previewRight))).toBeGreaterThan(245);
  await formatLeft.selectOption('image/jpeg');
  await expect(qualityLeft).toHaveValue('0.35');

  await formatLeft.selectOption('original');
  await formatRight.selectOption('original');
  await expect(page.getByRole('img', { name: '元画像のプレビュー' })).toBeVisible();
  await expect(page.locator('.image-original-layer')).toHaveClass(/image-original-left.*image-original-right|image-original-right.*image-original-left/);
  await expect(page.locator('.image-stage canvas')).toHaveCount(1);
  await expect(leftPanel.getByRole('status')).toHaveText(/元ファイル比 0%/);
  await expect(rightPanel.getByRole('status')).toHaveText(/元ファイル比 0%/);
  expect(await saveImage(page, saveLeft, image.name)).toEqual(image.buffer);
  expect(await saveImage(page, saveRight, image.name)).toEqual(image.buffer);

  await page.getByRole('navigation').getByRole('link', { name: '全角・半角変換' }).click();
  await page.goBack();
  await expect(page.locator('.image-drop')).toBeVisible();
  await expect(saveLeft).toBeHidden();
  await expect(saveRight).toBeHidden();
});

test('4種類のサンプルを選び、元データとJPEG・PNG変換結果を保存する', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  const sampleSection = page.locator('.image-samples');
  await sampleSection.evaluate(element => {
    (window as Window & { sampleNodesBefore?: Element[] }).sampleNodesBefore = [...element.querySelectorAll('.image-sample')];
  });
  await expect(sampleSection).toHaveCount(1);
  await expect(sampleSection).toBeVisible();
  expect(await page.locator('.image-sample-list').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(4);
  await expect(page.locator('.image-drop')).toHaveCount(1);
  expect(await sampleSection.evaluate(element => element.compareDocumentPosition(document.querySelector('.image-drop')!) & Node.DOCUMENT_POSITION_FOLLOWING)).toBeTruthy();
  const samples = [
    { name: 'レッサーパンダ・写真、3840 × 2560 px、JPEG、3.87 MB', filename: 'red-panda.jpg', dimensions: '3840 × 2560 px' },
    { name: '輪郭イラスト、1200 × 900 px、PNG、70.22 KB', filename: 'outline.png', dimensions: '1200 × 900 px' },
    { name: '架空のスマートフォン画面、900 × 1600 px、PNG、80.82 KB', filename: 'mobile-screen.png', dimensions: '900 × 1600 px' },
    { name: '透明な幾何学、1200 × 900 px、PNG、542.94 KB', filename: 'geometry.png', dimensions: '1200 × 900 px' },
  ];
  const thumbs = page.locator('.image-sample img');
  await expect(thumbs).toHaveCount(4);
  await expect(thumbs.nth(0)).toHaveAttribute('src', /\/web-toolbox\/samples\/red-panda-thumb\.jpg$/);
  for (const [index, sample] of samples.entries()) {
    const sampleButton = page.getByRole('button', { name: sample.name, exact: true });
    if (index === 0) {
      await sampleButton.focus();
      await sampleButton.press('Enter');
    } else {
      await sampleButton.click();
    }
    await expect(page.locator('.image-info')).toContainText(`${sample.filename} · ${sample.dimensions}`);
    if (index === 0) {
      await expect(sampleButton).toBeFocused();
      const previewBounds = (await page.locator('.image-stage').boundingBox())!;
      const viewportHeight = await page.evaluate(() => window.innerHeight);
      expect(previewBounds.y).toBeGreaterThanOrEqual(0);
      expect(previewBounds.y + previewBounds.height).toBeLessThanOrEqual(viewportHeight);
    }
    expect(await sampleSection.evaluate(element => [...element.querySelectorAll('.image-sample')].every((button, position) => button === (window as typeof window & { sampleNodesBefore?: Element[] }).sampleNodesBefore?.[position]))).toBe(true);
    const saved = await saveImage(page, page.getByRole('button', { name: '左をダウンロード' }), sample.filename);
    expect(saved).toEqual(await readFile(`public/samples/${sample.filename}`));
    if (index === 0) {
      const converted = await saveImage(page, page.getByRole('button', { name: '右をダウンロード' }), 'red-panda-right-q0.75.jpg');
      const dimensions = await page.evaluate(async base64 => {
        const image = new Image();
        image.src = `data:image/jpeg;base64,${base64}`;
        await image.decode();
        return [image.naturalWidth, image.naturalHeight];
      }, converted.toString('base64'));
      expect(dimensions).toEqual([3840, 2560]);
    }
  }

  await page.getByRole('button', { name: /輪郭イラスト/ }).click();
  await expect(page.locator('.image-info')).toContainText('outline.png · 1200 × 900 px');
  const leftSave = page.getByRole('button', { name: '左をダウンロード' });
  const rightSave = page.getByRole('button', { name: '右をダウンロード' });
  const rightFormat = page.getByLabel('右の形式');
  await rightFormat.selectOption('image/jpeg');
  const jpeg = await saveImage(page, rightSave, 'outline-right-q0.75.jpg');
  expect([...jpeg.subarray(0, 3)]).toEqual([255, 216, 255]);
  await rightFormat.selectOption('image/png');
  const png = await saveImage(page, rightSave, 'outline-right.png');
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  await expect(leftSave).toBeEnabled();
});

test('ズーム・パンを画像の固定倍率で行い、比較位置と変換状態を保つ', async ({ page, browserName }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  let workerCount = 0;
  page.on('worker', () => workerCount++);
  await page.locator('[type=file]').setInputFiles(await testImage(page, 800, 600));
  const stage = page.locator('.image-stage');
  const preview = page.getByAltText('右側のプレビュー');
  const original = page.getByRole('img', { name: '元画像のプレビュー' });
  const minus = page.getByRole('button', { name: '縮小' });
  const plus = page.getByRole('button', { name: '拡大' });
  const reset = page.getByRole('button', { name: /表示倍率を100%に戻す/ });
  const split = page.getByRole('slider', { name: '比較位置' });
  await expect(preview).toBeVisible();
  await expect(original).toBeVisible();
  const initialUrl = await preview.getAttribute('src');
  const initialGeometry = await stage.evaluate(element => {
    const stageRect = element.getBoundingClientRect();
    const canvas = element.querySelector('canvas')!.getBoundingClientRect();
    const image = element.querySelector('img[data-side="right"]')!.getBoundingClientRect();
    return {
      canvas: { x: canvas.x, y: canvas.y, width: canvas.width, height: canvas.height },
      image: { x: image.x, y: image.y, width: image.width, height: image.height },
      stage: { x: stageRect.x, y: stageRect.y, width: stageRect.width, height: stageRect.height },
    };
  });
  expect(initialGeometry.canvas.width).toBe(800);
  expect(initialGeometry.canvas.height).toBe(600);
  expect(initialGeometry.image).toEqual(initialGeometry.canvas);
  expect(initialGeometry.canvas.x + 400).toBeCloseTo(initialGeometry.stage.x + initialGeometry.stage.width / 2, 0);
  expect(initialGeometry.canvas.y + 300).toBeCloseTo(initialGeometry.stage.y + initialGeometry.stage.height / 2, 0);

  await split.focus();
  for (let index = 0; index < 15; index++) await split.press('ArrowRight');
  await plus.click();
  await expect(reset).toHaveText('125%');
  let geometry = await preview.boundingBox();
  expect(geometry!.width).toBe(1000);
  expect(geometry!.height).toBeCloseTo(750, 2);
  const dividerBeforePan = await stage.locator('.image-divider').boundingBox();
  await plus.click();
  await plus.click();
  await expect(reset).toHaveText('175%');
  await expect(split).toHaveAttribute('aria-valuenow', '65');
  await expect(plus).toBeEnabled();
  await expect(minus).toBeEnabled();
  const fixedClip = await stage.evaluate(element => {
    const stageRect = element.getBoundingClientRect();
    const left = element.querySelector('.image-layer[data-side="left"]')!;
    const right = element.querySelector('.image-layer[data-side="right"]')!;
    const leftRect = left.getBoundingClientRect();
    const rightRect = right.getBoundingClientRect();
    return {
      leftClip: getComputedStyle(left).clipPath,
      rightClip: getComputedStyle(right).clipPath,
      aligned: leftRect.x === stageRect.x + 1 && rightRect.x === stageRect.x + 1 &&
        leftRect.width === stageRect.width - 2 && rightRect.width === stageRect.width - 2,
    };
  });
  expect(fixedClip.leftClip).toContain('35%');
  expect(fixedClip.rightClip).toContain('65%');
  expect(fixedClip.aligned).toBe(true);
  await stage.scrollIntoViewIfNeeded();
  const bounds = (await stage.boundingBox())!;
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(bounds.x + bounds.width / 2 - 80, bounds.y + bounds.height / 2 - 50);
  await page.mouse.up();
  const moved = await preview.boundingBox();
  expect(moved!.x).toBeLessThan(initialGeometry.image.x);
  expect(moved!.y).toBeLessThan(initialGeometry.image.y);
  const dividerAfterPan = await stage.locator('.image-divider').boundingBox();
  expect(dividerAfterPan!.x).toBeCloseTo(dividerBeforePan!.x, 0);
  await expect(preview).toHaveAttribute('src', initialUrl!);

  if (browserName === 'chromium') {
    const session = await page.context().newCDPSession(page);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 1 });
    const touchBounds = (await stage.boundingBox())!;
    const x = touchBounds.x + touchBounds.width / 2;
    const y = touchBounds.y + touchBounds.height / 2;
    const beforeTouch = await preview.boundingBox();
    await session.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x - 30, y: y - 25, id: 1 }] });
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    const afterTouch = await preview.boundingBox();
    expect(afterTouch!.x).toBeLessThan(beforeTouch!.x);
    expect(afterTouch!.y).toBeLessThan(beforeTouch!.y);
    await session.send('Emulation.setTouchEmulationEnabled', { enabled: false });
    await session.detach();
  }

  await stage.scrollIntoViewIfNeeded();
  const resizeBounds = (await stage.boundingBox())!;
  await page.mouse.move(resizeBounds.x + resizeBounds.width * 0.25, resizeBounds.y + resizeBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(resizeBounds.x + 1, resizeBounds.y + 1);
  await page.mouse.up();
  const viewBeforeResize = await stage.evaluate(element => ({ x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y') }));
  expect(Number.parseFloat(viewBeforeResize.x)).toBeLessThan(0);
  expect(Number.parseFloat(viewBeforeResize.y)).toBeLessThan(0);
  await page.setViewportSize({ width: 2560, height: 1800 });
  await expect.poll(() => stage.evaluate(element => ({
    x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y'),
  }))).not.toEqual(viewBeforeResize);
  const clamped = await stage.evaluate(element => {
    const width = Number.parseFloat(element.style.getPropertyValue('--image-width'));
    const height = Number.parseFloat(element.style.getPropertyValue('--image-height'));
    const zoom = Number.parseFloat(element.style.getPropertyValue('--zoom'));
    return {
      x: Number.parseFloat(element.style.getPropertyValue('--pan-x')),
      y: Number.parseFloat(element.style.getPropertyValue('--pan-y')),
      maxX: Math.max(0, (width * zoom - element.clientWidth) / 2),
      maxY: Math.max(0, (height * zoom - element.clientHeight) / 2),
    };
  });
  expect(clamped.x).toBeCloseTo(-clamped.maxX, 0);
  expect(clamped.y).toBeCloseTo(-clamped.maxY, 0);
  await page.setViewportSize({ width: 1280, height: 900 });
  await expect(preview).toBeVisible();
  await stage.scrollIntoViewIfNeeded();
  const currentBounds = (await stage.boundingBox())!;
  await page.mouse.move(currentBounds.x + currentBounds.width / 2, currentBounds.y + currentBounds.height / 2);
  await page.mouse.down();
  await page.mouse.move(currentBounds.x + currentBounds.width / 2 - 60, currentBounds.y + currentBounds.height / 2 - 30);
  await page.mouse.up();
  const panBeforeSettings = await stage.evaluate(element => ({ x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y') }));
  await page.getByLabel('左の形式').selectOption('image/jpeg');
  const leftQuality = page.getByRole('slider', { name: '左のJPEG品質' });
  await leftQuality.fill('0.40');
  await expect(reset).toHaveText('175%');
  expect(await stage.evaluate(element => ({ x: element.style.getPropertyValue('--pan-x'), y: element.style.getPropertyValue('--pan-y') }))).toEqual(panBeforeSettings);
  await expect(preview).toHaveAttribute('src', initialUrl!);
  expect(workerCount).toBe(0);

  await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
    buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
  await expect(page.locator('.image-input-error')).toContainText('読み込めません');
  await expect(reset).toHaveText('175%');
  await expect(split).toHaveAttribute('aria-valuenow', '65');
  expect(await preview.getAttribute('src')).toBe(initialUrl);

  await page.locator('[type=file]').setInputFiles(await testImage(page, 64, 32));
  await expect(reset).toHaveText('100%');
  await expect(split).toHaveAttribute('aria-valuenow', '50');
  geometry = await preview.boundingBox();
  expect(geometry!.width).toBe(64);
  expect(geometry!.height).toBe(32);
  expect(await preview.getAttribute('src')).not.toBe(initialUrl);
  await stage.focus();
  await stage.press('ArrowRight');
  await expect(stage).toHaveCSS('--pan-x', '0px');
  for (let index = 0; index < 3; index++) await minus.click();
  await expect(reset).toHaveText('25%');
  await expect(minus).toBeDisabled();
  for (let index = 0; index < 15; index++) await plus.click();
  await expect(reset).toHaveText('400%');
  await expect(plus).toBeDisabled();
});

test('倍率操作はプレビュー直下に右寄せし、狭い画面と両テーマで収まる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  await page.getByLabel('画質の自動評価').uncheck();
  await page.locator('[type=file]').setInputFiles(await testImage(page));

  const tools = page.getByRole('group', { name: '表示倍率' });
  const reset = page.getByRole('button', { name: /表示倍率を100%に戻す/ });
  const plus = page.getByRole('button', { name: '拡大' });

  for (const [width, scheme] of [
    [1280, 'light'],
    [1280, 'dark'],
    [320, 'light'],
    [320, 'dark'],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);

    const layout = await page.evaluate(() => {
      const stage = document.querySelector('.image-stage')!;
      const tools = document.querySelector('.image-view-tools')!;
      const settings = document.querySelector('.image-controls')!;
      const rect = (element: Element) => {
        const { x, y, width, height, right, bottom } = element.getBoundingClientRect();
        return { x, y, width, height, right, bottom };
      };
      const buttons = [...tools.querySelectorAll('button')].map(rect);
      return {
        adjacent: stage.nextElementSibling === tools,
        stage: rect(stage),
        tools: rect(tools),
        settings: rect(settings),
        buttons,
        scrollWidth: document.documentElement.scrollWidth,
      };
    });
    expect(layout.adjacent).toBe(true);
    expect(layout.tools.y).toBeGreaterThanOrEqual(layout.stage.bottom);
    expect(layout.tools.right).toBeCloseTo(layout.stage.right, 0);
    expect(layout.settings.y).toBeGreaterThanOrEqual(layout.tools.bottom);
    expect(layout.scrollWidth).toBeLessThanOrEqual(width);
    for (let index = 1; index < layout.buttons.length; index++) {
      expect(layout.buttons[index - 1]!.right).toBeLessThanOrEqual(layout.buttons[index]!.x);
    }

    await expect(tools).toBeVisible();
    await reset.focus();
    await page.keyboard.press('Tab');
    await expect(plus).toBeFocused();
    expect(await plus.evaluate(button => getComputedStyle(button).outlineStyle)).not.toBe('none');
    await plus.press('Enter');
    await expect(reset).toHaveText('125%');
    await reset.press('Enter');
    await expect(reset).toHaveText('100%');
  }
});

test('画像選択エリアは画面高に追従し、文言を中央に収める', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const drop = page.locator('.image-drop');

  for (const [width, height, expected] of [
    [1280, 600, 252],
    [1280, 900, 378],
    [320, 720, 216],
  ] as const) {
    await page.setViewportSize({ width, height });
    const bounds = (await drop.boundingBox())!;
    expect(bounds.height).toBeCloseTo(expected, 0);
    const textBounds = await drop.locator('strong, span').evaluateAll(elements =>
      elements.map(element => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }),
    );
    for (const text of textBounds) {
      expect(text.x).toBeGreaterThanOrEqual(bounds.x);
      expect(text.x + text.width).toBeLessThanOrEqual(bounds.x + bounds.width);
      expect(text.y).toBeGreaterThanOrEqual(bounds.y);
      expect(text.y + text.height).toBeLessThanOrEqual(bounds.y + bounds.height);
      expect(text.x + text.width / 2).toBeCloseTo(bounds.x + bounds.width / 2, 0);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
  }
});

test('320pxの両テーマでドロップ後も失敗した置換から復帰できる', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 720 });
  for (const scheme of ['dark', 'light'] as const) {
    await page.goto('./?tool=image-converter');
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    const initial = page.locator('.image-drop');
    const initialBounds = (await initial.boundingBox())!;
    const samplesBefore = (await page.locator('.image-samples').boundingBox())!;
    const sampleButtons = page.locator('.image-sample');
    const sampleBounds = await sampleButtons.evaluateAll(buttons => buttons.map(button => {
      const { x, y } = button.getBoundingClientRect();
      return { x, y };
    }));
    expect(await page.locator('.image-sample-list').evaluate(element => getComputedStyle(element).gridTemplateColumns.split(' ').length)).toBe(2);
    expect(await sampleButtons.nth(0).getAttribute('aria-label')).toContain('1280 × 853 px、JPEG、314.62 KB');
    expect(await sampleButtons.nth(0).locator('span').evaluate(element => getComputedStyle(element).display)).toBe('none');
    expect(sampleBounds[0]!.y).toBe(sampleBounds[1]!.y);
    expect(sampleBounds[2]!.y).toBe(sampleBounds[3]!.y);
    expect(sampleBounds[0]!.y).toBeLessThan(sampleBounds[2]!.y);
    expect(samplesBefore.y + samplesBefore.height).toBeLessThan(initialBounds.y);
    expect(initialBounds.height).toBe(216);
    await initial.evaluate(async button => {
      const canvas = document.createElement('canvas');
      const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), 'image/webp'));
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(new File([blob], 'drop.webp', { type: blob.type }));
      button.dispatchEvent(new DragEvent('drop', { dataTransfer, bubbles: true, cancelable: true }));
    });
    const saveLeft = page.getByRole('button', { name: '左をダウンロード' });
    const saveRight = page.getByRole('button', { name: '右をダウンロード' });
    await expect(saveLeft).toBeEnabled();
    await expect(saveRight).toBeEnabled();
    await expect(initial).toBeHidden();
    const samplesAfter = (await page.locator('.image-samples').boundingBox())!;
    const comparisonBounds = (await page.locator('.image-comparison-area').boundingBox())!;
    expect(samplesAfter.y).toBeCloseTo(samplesBefore.y, 0);
    expect(samplesAfter.height).toBeCloseTo(samplesBefore.height, 0);
    expect(comparisonBounds.y).toBeGreaterThanOrEqual(samplesAfter.y + samplesAfter.height);
    expect(comparisonBounds.width).toBeCloseTo(initialBounds.width, 0);
    await page.locator('[type=file]').setInputFiles({ name: 'broken.png', mimeType: 'image/png',
      buffer: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    const inputError = page.locator('.image-input-error');
    await expect(inputError).toHaveAttribute('role', 'alert');
    await expect(inputError).toContainText('読み込めません');
    await expect(page.locator('.image-tool > section[aria-label="画像の比較と変換設定"]')).toBeVisible();
    await expect(saveLeft).toBeEnabled();
    await expect(page.locator('.image-info')).toContainText('drop.webp');
    const left = (await page.getByRole('group', { name: '左の設定' }).boundingBox())!;
    const right = (await page.getByRole('group', { name: '右の設定' }).boundingBox())!;
    expect(left.y + left.height).toBeLessThan(right.y);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320);
    const recovery = await testImage(page);
    await page.locator('[type=file]').setInputFiles(recovery);
    await expect(page.locator('.image-info')).toContainText(recovery.name);
    await expect(inputError).toBeEmpty();
  }
});

test('比較画像エリアへのドロップと画像変更ボタンで置き換え、同じファイルを再選択できる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  const replacement = await testImage(page, 32, 16);
  const initial = page.getByRole('button', { name: /画像を選択/ });
  await expect(initial).toBeVisible();
  expect((await initial.boundingBox())!.height).toBeCloseTo(302.4, 0);
  // Keep interception enabled across consecutive dialogs, including on Firefox.
  const choosers: FileChooser[] = [];
  page.on('filechooser', chooser => choosers.push(chooser));
  await initial.press('Enter');
  await expect.poll(() => choosers.length).toBe(1);
  await choosers[0]!.setFiles(image);
  const comparison = page.locator('.image-comparison-area');
  const info = page.locator('.image-info');
  const rightPreview = page.getByAltText('右側のプレビュー');
  await expect(info).toContainText(image.name);

  const drag = await comparison.evaluate((area, bytes) => {
    const slider = area.querySelector('.image-divider')!;
    const file = new File([Uint8Array.from(bytes)], 'replacement.png', { type: 'image/png' });
    const files = new DataTransfer();
    files.items.add(file);
    const text = new DataTransfer();
    text.setData('text/plain', 'テキスト');
    const dispatch = (target: Element, type: string, dataTransfer: DataTransfer) =>
      !target.dispatchEvent(new DragEvent(type, { dataTransfer, bubbles: true, cancelable: true }));
    const highlighted = () => area.classList.contains('is-over');
    const textPrevented = ['dragenter', 'dragover', 'drop'].map(type => dispatch(slider, type, text));
    dispatch(area, 'dragenter', files);
    const highlightedOnEnter = highlighted();
    dispatch(slider, 'dragenter', files);
    dispatch(area, 'dragleave', files);
    const highlightedOnChild = highlighted();
    dispatch(slider, 'dragleave', files);
    const highlightedOnLeave = highlighted();
    dispatch(slider, 'dragenter', files);
    const fileOverPrevented = dispatch(slider, 'dragover', files);
    const fileDropPrevented = dispatch(slider, 'drop', files);
    return { textPrevented, highlightedOnEnter, highlightedOnChild, highlightedOnLeave, fileOverPrevented,
      fileDropPrevented, highlightedAfterDrop: highlighted() };
  }, [...replacement.buffer]);
  expect(drag).toEqual({
    textPrevented: [false, false, false],
    highlightedOnEnter: true,
    highlightedOnChild: true,
    highlightedOnLeave: false,
    fileOverPrevented: true,
    fileDropPrevented: true,
    highlightedAfterDrop: false,
  });
  await expect(info).toContainText('replacement.png');
  await expect(info).toContainText('32 × 16 px');
  await expect(rightPreview).toBeVisible();
  const change = page.getByRole('button', { name: '画像を変更' });
  for (let attempt = 0; attempt < 2; attempt++) {
    const previousUrl = await rightPreview.getAttribute('src');
    await change.click();
    await expect.poll(() => choosers.length).toBe(attempt + 2);
    await choosers[attempt + 1]!.setFiles(image);
    await expect(page.locator('[type=file]')).toHaveValue('');
    await expect(info).toContainText(image.name);
    await expect(info).toContainText('64 × 32 px');
    await expect(rightPreview).not.toHaveAttribute('src', previousUrl!);
    await expect(rightPreview).toBeVisible();
  }
  await expect(initial).toBeHidden();
  await expect(comparison).toBeVisible();
});

test('変換に失敗した側を通知し、反対側は個別に保存・復旧できる', async ({ page }) => {
  await page.goto('./?tool=image-converter');
  const image = await testImage(page);
  await page.evaluate(() => {
    HTMLCanvasElement.prototype.toBlob = callback => callback(null);
  });
  await page.locator('[type=file]').setInputFiles(image);
  const left = page.getByRole('group', { name: '左の設定' });
  const right = page.getByRole('group', { name: '右の設定' });
  await expect(right.getByRole('alert')).toContainText('右側：指定形式に変換できませんでした');
  await expect(right.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('status')).toBeEmpty();
  expect(await saveImage(page, left.getByRole('button'), image.name)).toEqual(image.buffer);
  await expect(left.getByRole('status')).toHaveText(/元ファイル比 0%/);

  await left.getByLabel('左の形式').selectOption('image/png');
  await expect(left.getByRole('alert')).toContainText('左側：指定形式に変換できませんでした');
  await expect(left.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('alert')).toContainText('指定形式に変換できませんでした');
  await expect(right.getByRole('button')).toBeDisabled();
  await expect(left.getByRole('status')).toBeEmpty();
  await right.getByLabel('右の形式').selectOption('original');
  await expect(right.getByRole('alert')).toBeEmpty();
  await expect(left.getByRole('button')).toBeDisabled();
  await expect(right.getByRole('button')).toBeEnabled();
  await expect(right.getByRole('status')).toHaveText(/元ファイル比 0%/);
});

test.describe('タッチ操作', () => {
  test.use({ hasTouch: true, viewport: { width: 320, height: 720 } });

  test('比較位置をタップしても再変換しない', async ({ page }) => {
    await page.goto('./?tool=image-converter');
    await page.locator('[type=file]').setInputFiles(await testImage(page));
    const preview = page.getByAltText('右側のプレビュー');
    await expect(preview).toBeVisible();
    const url = await preview.getAttribute('src');
    const split = page.getByRole('slider', { name: '比較位置' });
    await split.scrollIntoViewIfNeeded();
    const bounds = (await split.boundingBox())!;
    await expect(split).toHaveAttribute('aria-valuenow', '50');
    expect(await split.evaluate(element => getComputedStyle(element).touchAction)).toBe('none');
    await page.touchscreen.tap(bounds.x + bounds.width * 0.75, bounds.y + bounds.height / 2);
    expect(Number(await split.getAttribute('aria-valuenow'))).toBeGreaterThan(50);
    expect(Number(await split.getAttribute('aria-valuenow'))).toBeLessThan(60);
    await expect(preview).toHaveAttribute('src', url!);
  });
});

test('元画像とHTML Canvasが作った左右のJPEGをWasmで評価し、変更した側だけ失効する', async ({ page, baseURL }) => {
  const url = new URL(baseURL!);
  const external: string[] = [];
  await page.context().route(/^https?:/, route => {
    const request = route.request();
    if (new URL(request.url()).origin === url.origin && request.method() === 'GET' && !request.postData()) {
      return route.continue();
    }
    external.push(request.url());
    return route.abort();
  });
  await page.addInitScript(() => {
    const encodings = new WeakMap<Blob, Uint8ClampedArray>();
    const checks: { referenceMatches: boolean; decodesMatch: Promise<boolean> }[] = [];
    Object.assign(window, { imageQualityChecks: checks });
    const toBlob = HTMLCanvasElement.prototype.toBlob;
    HTMLCanvasElement.prototype.toBlob = function (callback, type, quality) {
      if (type !== 'image/jpeg') return toBlob.call(this, callback, type, quality);
      const sourcePixels = this.getContext('2d')!.getImageData(0, 0, this.width, this.height).data;
      return toBlob.call(this, blob => {
        if (blob) encodings.set(blob, sourcePixels);
        callback(blob);
      }, type, quality);
    };

    function read(image: ImageBitmap, canvas: HTMLCanvasElement | OffscreenCanvas) {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true })!;
      context.fillStyle = '#fff';
      context.fillRect(0, 0, image.width, image.height);
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    }
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function (message: unknown) {
      const { reference, jpegs } = message as { reference: ImageBitmap; jpegs: Blob[] };
      const { width, height } = reference;
      const normalizer = new OffscreenCanvas(width, height);
      const original = read(reference, normalizer);
      checks.push({
        referenceMatches: jpegs.every(blob => encodings.get(blob)?.every((byte, i) => byte === original[i])),
        decodesMatch: Promise.all(jpegs.map(async blob => {
          const image = await createImageBitmap(blob);
          try {
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const html = read(image, canvas);
            const offscreen = read(image, new OffscreenCanvas(width, height));
            return html.every((byte, i) => byte === offscreen[i]) && html.some((byte, i) => byte !== original[i]);
          } finally {
            image.close();
          }
        })).then(values => values.every(Boolean)),
      });
      Reflect.apply(post, this, arguments);
    };
  });

  await page.goto('./?tool=image-converter');
  const jpegScore = /^SSIMULACRA2: -?\d+\.\d$/;
  const button = page.getByRole('button', { name: '画質を評価', exact: true });
  const left = page.locator('.image-panel[data-side=left] .image-score');
  const right = page.locator('.image-panel[data-side=right] .image-score');
  const status = page.locator('.image-evaluation-status');
  const input = await testImage(page);
  await page.getByRole('checkbox', { name: '画質の自動評価' }).uncheck();
  await page.locator('[type=file]').setInputFiles(input);
  await expect(left).toHaveText('基準画像');
  await page.getByLabel('左の形式').selectOption('image/jpeg');
  await page.getByLabel('左のJPEG品質').fill('0.25');
  await expect(button).toBeEnabled();
  const wasmLoaded = page.waitForResponse(response => /\/web-toolbox\/assets\/ssimulacra2-0\.1\.0-[\w-]+\.wasm$/.test(response.url()));
  const workerStarted = page.waitForEvent('worker');
  await button.click();
  const worker = await workerStarted;
  expect(new URL(worker.url()).pathname).toMatch(/^\/web-toolbox\/assets\//);
  const wasm = await wasmLoaded;
  expect(wasm.ok()).toBe(true);
  expect(wasm.headers()['content-type']).toContain('application/wasm');
  await expect(status).toContainText('完了');
  await expect(left).toHaveText(jpegScore);
  await expect(right).toHaveText(jpegScore);
  expect(Number((await right.textContent())?.split(': ')[1])).toBeLessThan(100);
  const checks = await page.evaluate(async () => {
    const state = window as Window & { imageQualityChecks?: { referenceMatches: boolean; decodesMatch: Promise<boolean> }[] };
    return Promise.all((state.imageQualityChecks ?? []).map(async item => [item.referenceMatches, await item.decodesMatch]));
  });
  expect(checks).toEqual([[true, true]]);
  const rightScore = await right.textContent();

  await page.getByLabel('左のJPEG品質').fill('0.90');
  await expect(left).not.toHaveText(jpegScore);
  await expect(right).toHaveText(rightScore!);
  await expect(button).toBeEnabled();
  await expect(left).toHaveText('画質は未評価');
  await page.getByLabel('左の形式').selectOption('image/png');
  await expect(left).toHaveText('画質評価は未対応');
  await expect(page.getByRole('button', { name: '左をダウンロード' })).toBeEnabled();
  expect(external).toEqual([]);
});

test('初回と品質変更後に自動評価し、連続操作では最後の出力だけを採点する', async ({ page }) => {
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const auto = page.getByRole('checkbox', { name: '画質の自動評価' });
  const score = page.locator('.image-panel[data-side=right] .image-score');
  const quality = page.getByRole('slider', { name: '右のJPEG品質' });
  const status = page.locator('.image-evaluation-status');
  const save = page.getByRole('button', { name: '右をダウンロード' });
  const jpegScore = /^SSIMULACRA2: -?\d+\.\d$/;
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  await expect(auto).toBeChecked();
  await expect(save).toBeEnabled();
  await expect(status).toContainText('待機');
  await page.clock.runFor(800);
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(jpegScore);
  const initialScore = await score.textContent();
  expect(workers).toHaveLength(1);

  await quality.fill('0.45');
  await expect(score).not.toHaveText(jpegScore);
  await page.clock.runFor(150);
  await quality.fill('0.15');
  await page.clock.runFor(150);
  await quality.fill('0.01');
  await page.clock.runFor(180);
  await expect(save).toBeEnabled();
  await expect(score).toHaveText('画質は未評価');
  await page.clock.runFor(619);
  expect(workers).toHaveLength(1);
  await page.clock.runFor(1);
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(jpegScore);
  await expect(score).not.toHaveText(initialScore!);
  expect(workers).toHaveLength(2);

  await auto.press('Space');
  await expect(auto).not.toBeChecked();
  await quality.fill('0.60');
  await page.clock.runFor(1600);
  await expect(save).toBeEnabled();
  await expect(score).toHaveText('画質は未評価');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  await expect(auto).not.toBeChecked();
  await expect(save).toBeEnabled();
  await page.clock.runFor(800);
  expect(workers).toHaveLength(2);
  await expect.poll(() => page.workers().length).toBe(0);

  await auto.check();
  await page.clock.runFor(800);
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(jpegScore);
  expect(workers).toHaveLength(3);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('2048×2048のJPEGを実Wasmで自動評価する', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('./?tool=image-converter');
  const wasmLoaded = page.waitForResponse('**/web-toolbox/assets/ssimulacra2-0.1.0-*.wasm');
  await page.locator('[type=file]').setInputFiles(await testImage(page, 2048, 2048));
  await expect(page.locator('.image-info')).toContainText('2048 × 2048 px');
  await expect(page.locator('.image-evaluation-limit')).toBeEmpty();
  expect((await wasmLoaded).ok()).toBe(true);
  await expect(page.locator('.image-evaluation-status')).toContainText('完了', { timeout: 30_000 });
  await expect(page.locator('.image-panel[data-side=right] .image-score')).toHaveText(/^SSIMULACRA2: -?\d+\.\d$/);
  await expect.poll(() => page.workers().length).toBe(0);
});

test('評価の画素数を超えてもJPEGの変換と保存が使える', async ({ page }) => {
  await pauseUiClock(page);
  await page.goto('./?tool=image-converter');
  const workers: string[] = [];
  page.on('worker', worker => workers.push(worker.url()));
  const image = await testImage(page, 3200, 3200);
  await page.locator('[type=file]').setInputFiles({ ...image, name: 'large.png' });
  await expect(page.locator('.image-evaluation-limit')).toContainText('10,000,000画素');
  await expect(page.getByRole('button', { name: '画質を評価' })).toBeDisabled();
  const jpeg = await saveImage(page, page.getByRole('button', { name: '右をダウンロード' }), 'large-right-q0.75.jpg');
  expect([...jpeg.subarray(0, 3)]).toEqual([255, 216, 255]);
  await page.clock.runFor(800);
  expect(workers).toHaveLength(0);
  expect(page.workers()).toHaveLength(0);
});

test('狭い画面と両テーマで、Wasmロード中の中止と失敗から再評価できる', async ({ page }) => {
  await pauseUiClock(page);
  await page.setViewportSize({ width: 360, height: 720 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('./?tool=image-converter');
  await page.locator('[type=file]').setInputFiles(await testImage(page));
  const start = page.getByRole('button', { name: '画質を評価' });
  const cancel = page.getByRole('button', { name: '評価を中止' });
  const auto = page.getByRole('checkbox', { name: '画質の自動評価' });
  const status = page.locator('.image-evaluation-status');
  const score = page.locator('.image-panel[data-side=right] .image-score');
  const wasm = '**/ssimulacra2-0.1.0-*.wasm';
  const scoringLockHeld = () => page.evaluate(async () => {
    const { held } = await navigator.locks.query();
    return held?.some(lock => lock.name?.startsWith('web-toolbox:image-quality:')) ?? false;
  });
  let release!: () => void;
  const blocked = new Promise<void>(resolve => { release = resolve; });
  await page.route(wasm, async route => {
    await blocked;
    await route.abort().catch(() => {});
  }, { times: 1 });
  try {
    const requested = page.waitForRequest(wasm);
    await expect(status).toContainText('待機');
    await page.clock.runFor(800);
    await requested;
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(status).toContainText('評価しています');
    await expect.poll(scoringLockHeld).toBe(true);
    await cancel.click();
    await expect(status).toContainText('中止しました');
    await expect(score).toHaveText('画質は未評価');
    await expect(start).toBeEnabled();
    await expect.poll(() => page.workers().length).toBe(0);
    await expect.poll(scoringLockHeld).toBe(false);
    await page.clock.runFor(1600);
    await expect(status).toContainText('中止しました');
    await expect(score).toHaveText('画質は未評価');
  } finally {
    release();
  }

  await page.emulateMedia({ colorScheme: 'light' });
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await page.route(wasm, route => route.fulfill({ status: 503 }), { times: 1 });
  await start.click();
  await expect(status).toContainText('評価できませんでした');
  await expect(page.getByRole('button', { name: '右をダウンロード' })).toBeEnabled();
  await start.click();
  await expect(status).toContainText('完了');
  await expect(score).toHaveText(/^SSIMULACRA2: /);
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme });
    await expect(page.locator('html')).toHaveAttribute('data-theme', scheme);
    await expect(auto).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(360);
  }
});
