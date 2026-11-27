// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode } from './encoder';
import { encodeOxipng } from './oxipng/client';
import { encodeAvif } from './avif/client';
import { encodeMozjpeg } from './mozjpeg/client';
import { encodeWebp } from './webp/client';
import { encodeJxl } from './jxl/client';
import { detectJxlSupport, type JxlSupport } from './jxl/support';
import { mount } from './index';

vi.mock('./encoder', async importOriginal => ({
  ...await importOriginal<typeof import('./encoder')>(), decode: vi.fn(), encode: vi.fn(),
}));
vi.mock('./oxipng/client', () => ({ encodeOxipng: vi.fn() }));
vi.mock('./avif/client', () => ({ encodeAvif: vi.fn() }));
vi.mock('./mozjpeg/client', () => ({ encodeMozjpeg: vi.fn() }));
vi.mock('./webp/client', () => ({ encodeWebp: vi.fn() }));
vi.mock('./jxl/client', () => ({ encodeJxl: vi.fn() }));
vi.mock('./jxl/support', () => ({ detectJxlSupport: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const bitmap = (width = 64, height = 32) => ({ width, height, close: vi.fn() }) as unknown as ImageBitmap;
const jpeg = new Blob(['1234'], { type: 'image/jpeg' });
const png = new Blob(['1'], { type: 'image/png' });
const oxipngPng = new Blob(['optimized'], { type: 'image/png' });
const avif = new Blob(['avif'], { type: 'image/avif' });
const webp = new Blob(['webp'], { type: 'image/webp' });
const jxl = new Blob(['jxl'], { type: 'image/jxl' });
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function setup(active = bitmap(), jxlSupport: JxlSupport = { input: true, preview: true }) {
  vi.useFakeTimers();
  vi.mocked(decode).mockResolvedValue(active);
  vi.mocked(encode).mockImplementation(async (_, type) => type === 'image/jpeg' ? jpeg : png);
  vi.mocked(encodeOxipng).mockResolvedValue(oxipngPng);
  vi.mocked(encodeAvif).mockResolvedValue(avif);
  vi.mocked(encodeWebp).mockResolvedValue(webp);
  vi.mocked(encodeMozjpeg).mockResolvedValue(jpeg);
  vi.mocked(encodeJxl).mockResolvedValue(jxl);
  vi.mocked(detectJxlSupport).mockResolvedValue(jxlSupport);
  let urlNumber = 0;
  const createUrl = vi.fn((_blob: Blob) => 'blob:result-' + ++urlNumber);
  const revokeUrl = vi.fn();
  vi.stubGlobal('URL', class extends URL {
    static override createObjectURL = createUrl;
    static override revokeObjectURL = revokeUrl;
  });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const unmount = mount(document.body);
  dispose = unmount;
  const input = document.querySelector<HTMLInputElement>('[type=file]')!;
  const choose = (name = 'input.png', target?: HTMLElement, contents: BlobPart = '12') => {
    const files = [new File([contents], name, { type: 'image/png' })];
    if (target) {
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files, types: ['Files'] } });
      target.dispatchEvent(event);
    } else {
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new Event('change'));
    }
    return files[0]!;
  };
  const get = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;
  function side(id: string) {
    const panel = get(`.image-panel[data-side="${id}"]`);
    const format = panel.querySelector('select')!;
    const slider = panel.querySelector<HTMLInputElement>('.image-quality input')!;
    const preview = get<HTMLImageElement>(`img[data-side="${id}"]`);
    const decodePreview = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
    preview.decode = decodePreview;
    return {
      format, slider, preview, decodePreview,
      output: panel.querySelector<HTMLParagraphElement>('.image-result')!,
      error: panel.querySelector('.image-error')!,
      score: panel.querySelector('.image-score')!,
      save: panel.querySelector<HTMLButtonElement>('.image-save')!,
      qualityLabel: panel.querySelector<HTMLElement>('.image-quality')!,
      avifSettings: panel.querySelector<HTMLElement>('.image-avif-settings')!,
      avifQuality: panel.querySelector<HTMLInputElement>('.image-avif-quality')!,
      avifAlpha: panel.querySelector<HTMLInputElement>('.image-avif-alpha')!,
      avifSpeed: panel.querySelector<HTMLInputElement>('.image-avif-speed')!,
      avifSubsample: panel.querySelector<HTMLSelectElement>('.image-avif-subsample')!,
      avifLossless: panel.querySelector<HTMLInputElement>('.image-avif-lossless')!,
      avifStatus: panel.querySelector<HTMLElement>('.image-avif-status')!,
      avifCancel: panel.querySelector<HTMLButtonElement>('.image-avif-cancel')!,
      avifRetry: panel.querySelector<HTMLButtonElement>('.image-avif-retry')!,
      mozjpegQuality: panel.querySelector<HTMLInputElement>('.image-mozjpeg-quality')!,
      mozjpegSubsample: panel.querySelector<HTMLSelectElement>('.image-mozjpeg-subsample')!,
      mozjpegProgressive: panel.querySelector<HTMLInputElement>('.image-mozjpeg-progressive')!,
      mozjpegOptimize: panel.querySelector<HTMLInputElement>('.image-mozjpeg-optimize')!,
      mozjpegCancel: panel.querySelector<HTMLButtonElement>('.image-mozjpeg-cancel')!,
      mozjpegRetry: panel.querySelector<HTMLButtonElement>('.image-mozjpeg-retry')!,
      webpQuality: panel.querySelector<HTMLInputElement>('.image-webp-quality')!,
      webpAlpha: panel.querySelector<HTMLInputElement>('.image-webp-alpha')!,
      webpMethod: panel.querySelector<HTMLInputElement>('.image-webp-method')!,
      webpLossless: panel.querySelector<HTMLInputElement>('.image-webp-lossless')!,
      webpSharp: panel.querySelector<HTMLInputElement>('.image-webp-sharp')!,
      webpStatus: panel.querySelector<HTMLElement>('.image-webp-status')!,
      webpCancel: panel.querySelector<HTMLButtonElement>('.image-webp-cancel')!,
      webpRetry: panel.querySelector<HTMLButtonElement>('.image-webp-retry')!,
      jxlDistance: panel.querySelector<HTMLInputElement>('.image-jxl-distance')!,
      jxlDistanceValue: panel.querySelector('.image-jxl-distance + span')!,
      jxlEffort: panel.querySelector<HTMLInputElement>('.image-jxl-effort')!,
      jxlLossless: panel.querySelector<HTMLInputElement>('.image-jxl-lossless')!,
      jxlStatus: panel.querySelector<HTMLElement>('.image-jxl-status')!,
      jxlCancel: panel.querySelector<HTMLButtonElement>('.image-jxl-cancel')!,
      jxlRetry: panel.querySelector<HTMLButtonElement>('.image-jxl-retry')!,
      oxipngSettings: panel.querySelector<HTMLElement>('.image-oxipng-settings')!,
      oxipngLevel: panel.querySelector<HTMLSelectElement>('.image-oxipng-settings select')!,
      oxipngInterlace: panel.querySelector<HTMLInputElement>('.image-oxipng-interlace')!,
      oxipngAlpha: panel.querySelector<HTMLInputElement>('.image-oxipng-alpha')!,
      oxipngStatus: panel.querySelector<HTMLElement>('.image-oxipng-status')!,
      oxipngCancel: panel.querySelector<HTMLButtonElement>('.image-oxipng-cancel')!,
      oxipngRetry: panel.querySelector<HTMLButtonElement>('.image-oxipng-retry')!,
      select(value: string) {
        format.value = value;
        format.dispatchEvent(new Event('change'));
      },
      quality(value: string) {
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
      },
      setRange(input: HTMLInputElement, value: number) {
        input.value = String(value);
        input.dispatchEvent(new Event('input'));
      },
    };
  }
  return {
    active, createUrl, revokeUrl, download, choose, drop: get<HTMLElement>('.image-drop'),
    comparisonArea: get<HTMLElement>('.image-comparison-area'),
    stage: get<HTMLElement>('.image-stage'),
    zoomOut: get<HTMLButtonElement>('.image-zoom-out'),
    zoomReset: get<HTMLButtonElement>('.image-zoom-reset'),
    zoomIn: get<HTMLButtonElement>('.image-zoom-in'),
    divider: get<HTMLElement>('.image-divider'),
    input,
    change: get<HTMLButtonElement>('.image-change'),
    section: get<HTMLElement>('.image-tool > section[aria-label="画像の比較と変換設定"]'),
    inputError: get('.image-input-error'),
    left: side('left'), right: side('right'),
    info: get('.image-info'),
    auto: get<HTMLInputElement>('.image-evaluation-toggle input'),
    evaluate: get<HTMLButtonElement>('.image-evaluate'),
    cancel: get<HTMLButtonElement>('.image-evaluation-cancel'),
    evaluationStatus: get('.image-evaluation-status'),
    limit: get('.image-evaluation-limit'),
    getCanvas: () => get<HTMLCanvasElement>('canvas'),
    unmount() { unmount(); dispose = undefined; },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

function pointerEvent(type: string, pointerId: number, clientX = 0) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperties(event, {
    pointerId: { value: pointerId }, isPrimary: { value: true }, button: { value: 0 }, clientX: { value: clientX },
  });
  return event;
}

it('比較バーのARIA sliderは境界・Shift移動を反映し、パンと変換処理に干渉しない', async () => {
  const { choose, stage, divider, zoomIn } = setup();
  choose();
  await flush();
  const encodes = vi.mocked(encode).mock.calls.length;
  expect(divider.getAttribute('role')).toBe('slider');
  expect(divider.getAttribute('aria-valuemin')).toBe('0');
  expect(divider.getAttribute('aria-valuemax')).toBe('100');
  Object.defineProperties(stage, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
  });
  for (let index = 0; index < 12; index++) zoomIn.click();
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true }));
  expect(divider.getAttribute('aria-valuenow')).toBe('51');
  expect(stage.style.getPropertyValue('--pan-x')).toBe('0px');
  expect(divider.getAttribute('aria-valuetext')).toBe('左側 51%');
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true, cancelable: true }));
  expect(divider.getAttribute('aria-valuenow')).toBe('41');
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true, cancelable: true }));
  expect(divider.getAttribute('aria-valuenow')).toBe('0');
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  expect(divider.getAttribute('aria-valuenow')).toBe('0');
  divider.dispatchEvent(new KeyboardEvent('keydown', { key: 'End', bubbles: true, cancelable: true }));
  expect(divider.getAttribute('aria-valuenow')).toBe('100');
  expect(stage.style.getPropertyValue('--split')).toBe('100%');
  expect(vi.mocked(encode).mock.calls).toHaveLength(encodes);
});

it('比較バーはPointer Captureでドラッグし、cancel・画像変更・破棄時に後始末する', async () => {
  const { choose, divider, stage, unmount } = setup();
  const captures = new Set<number>();
  const release = vi.fn((id: number) => captures.delete(id));
  Object.defineProperties(divider, {
    setPointerCapture: { configurable: true, value: vi.fn((id: number) => captures.add(id)) },
    hasPointerCapture: { configurable: true, value: (id: number) => captures.has(id) },
    releasePointerCapture: { configurable: true, value: release },
    getBoundingClientRect: { configurable: true, value: () => ({ left: 10, width: 100, top: 0, height: 100, right: 110, bottom: 100, x: 10, y: 0, toJSON() {} }) },
  });
  Object.defineProperty(stage, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ left: 10, width: 100, top: 0, height: 100, right: 110, bottom: 100, x: 10, y: 0, toJSON() {} }),
  });
  choose();
  await flush();
  expect(divider.dispatchEvent(pointerEvent('pointerdown', 1, 60))).toBe(false);
  expect(divider.classList.contains('is-dragging')).toBe(true);
  expect(divider.getAttribute('aria-valuenow')).toBe('50');
  divider.dispatchEvent(pointerEvent('pointermove', 1, 85));
  expect(divider.getAttribute('aria-valuenow')).toBe('75');
  divider.dispatchEvent(pointerEvent('pointermove', 1, 150));
  expect(divider.getAttribute('aria-valuenow')).toBe('100');
  divider.dispatchEvent(pointerEvent('pointercancel', 1));
  expect(divider.classList.contains('is-dragging')).toBe(false);
  expect(release).toHaveBeenCalledWith(1);

  divider.dispatchEvent(pointerEvent('pointerdown', 4, 40));
  captures.delete(4);
  divider.dispatchEvent(pointerEvent('lostpointercapture', 4));
  expect(divider.classList.contains('is-dragging')).toBe(false);

  divider.dispatchEvent(pointerEvent('pointerdown', 2, 40));
  choose('replacement.png');
  await flush();
  expect(divider.getAttribute('aria-valuenow')).toBe('50');
  expect(divider.classList.contains('is-dragging')).toBe(false);
  expect(release).toHaveBeenCalledWith(2);

  divider.dispatchEvent(pointerEvent('pointerdown', 3, 40));
  unmount();
  expect(divider.classList.contains('is-dragging')).toBe(false);
  expect(release).toHaveBeenCalledWith(3);
});

it('ズームは25〜400%で刻み、矢印移動を境界に収め、処理状態を変えない', async () => {
  const { choose, stage, zoomIn, zoomOut, zoomReset, divider, createUrl } = setup();
  const { workers, copy } = mockScoring();
  const viewport = stage;
  Object.defineProperties(viewport, {
    clientWidth: { configurable: true, value: 100 },
    clientHeight: { configurable: true, value: 100 },
  });
  choose();
  await flush();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(copy).toHaveBeenCalledOnce();
  const encodes = vi.mocked(encode).mock.calls.length;
  const urls = createUrl.mock.calls.length;
  expect(document.querySelector('canvas')?.style.width).toBe('');
  expect(stage.style.getPropertyValue('--image-width')).toBe('64px');
  expect(zoomReset.textContent).toBe('100%');
  expect(divider.getAttribute('aria-valuenow')).toBe('50');

  for (let index = 0; index < 12; index++) zoomIn.click();
  expect(zoomReset.textContent).toBe('400%');
  expect(zoomIn.disabled).toBe(true);
  expect(workers).toHaveLength(1);
  expect(workers[0]!.terminate).not.toHaveBeenCalled();
  for (let index = 0; index < 12; index++) {
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    stage.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
  }
  expect(stage.style.getPropertyValue('--pan-x')).toBe('78px');
  expect(stage.style.getPropertyValue('--pan-y')).toBe('14px');
  zoomReset.click();
  expect(zoomReset.textContent).toBe('100%');
  expect(stage.style.getPropertyValue('--pan-x')).toBe('0px');
  expect(stage.style.getPropertyValue('--pan-y')).toBe('0px');
  expect(zoomOut.disabled).toBe(false);
  for (let index = 0; index < 3; index++) zoomOut.click();
  expect(zoomReset.textContent).toBe('25%');
  expect(zoomOut.disabled).toBe(true);
  expect(divider.getAttribute('aria-valuenow')).toBe('50');
  expect(vi.mocked(encode).mock.calls).toHaveLength(encodes);
  expect(createUrl.mock.calls).toHaveLength(urls);
  workers[0]!.reply({ index: 0, score: 90 });
  await flush();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  zoomIn.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(copy).toHaveBeenCalledOnce();
});

it('画像を変更ボタンに装飾アイコンを表示し、ボタン名を維持する', () => {
  const { change } = setup();
  expect(change.querySelector('svg.icon')).not.toBeNull();
  expect(change.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(change.textContent).toBe('画像を変更');
});

it('画質を評価ボタンに装飾アイコンを表示し、ボタン名を維持する', () => {
  const { evaluate } = setup();
  expect(evaluate.querySelector('svg.icon')).not.toBeNull();
  expect(evaluate.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  expect(evaluate.textContent).toBe('画質を評価');
});

it('サムネイルは独立した読み込み状態を持ち、load・error後も選択操作を受け付ける', () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(['sample'], { type: 'image/png' })));
  vi.stubGlobal('fetch', fetchMock);
  setup();
  const frames = [...document.querySelectorAll<HTMLElement>('.image-sample-thumbnail')];
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.image-sample')];
  expect(frames).toHaveLength(4);
  expect(frames.map(frame => frame.dataset.state)).toEqual(['loading', 'loading', 'loading', 'loading']);
  expect(frames[0]!.querySelector('svg.icon')?.getAttribute('aria-hidden')).toBe('true');
  expect(frames[0]!.querySelector('img')?.alt).toBe('');
  expect(frames[0]!.querySelector('img')?.decoding).toBe('async');

  frames[0]!.querySelector('img')!.dispatchEvent(new Event('load'));
  frames[1]!.querySelector('img')!.dispatchEvent(new Event('error'));
  expect(frames.map(frame => frame.dataset.state)).toEqual(['ready', 'error', 'loading', 'loading']);

  buttons[1]!.click();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('false');
  dispose?.();
  dispose = undefined;
  frames[2]!.querySelector('img')!.dispatchEvent(new Event('load'));
  expect(frames[2]!.dataset.state).toBe('loading');
});

it('キャッシュ済みサムネイルはDOM構築時にすぐreadyになる', () => {
  vi.spyOn(HTMLImageElement.prototype, 'complete', 'get').mockReturnValue(true);
  vi.spyOn(HTMLImageElement.prototype, 'currentSrc', 'get').mockImplementation(function (this: HTMLImageElement) {
    return this.src;
  });
  vi.spyOn(HTMLImageElement.prototype, 'naturalWidth', 'get').mockReturnValue(32);
  setup();
  expect([...document.querySelectorAll<HTMLElement>('.image-sample-thumbnail')].map(frame => frame.dataset.state))
    .toEqual(['ready', 'ready', 'ready', 'ready']);
});

it('4つのサンプルは種類・寸法・サイズを読み上げ、選択時にだけ本体を取得する', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(['sample'], { type: 'image/png' })));
  vi.stubGlobal('fetch', fetchMock);
  const { inputError } = setup();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.image-sample')];
  expect(buttons).toHaveLength(4);
  expect(buttons.map(button => button.getAttribute('aria-label'))).toEqual([
    'レッサーパンダ・写真、3840 × 2560 px、JPEG、3.87 MB',
    '輪郭イラスト、1200 × 900 px、PNG、70.22 KB',
    '架空のスマートフォン画面、900 × 1600 px、PNG、80.82 KB',
    '透明な幾何学、1200 × 900 px、PNG、542.94 KB',
  ]);
  expect(buttons.every(button => button.querySelector('img')?.loading === 'lazy')).toBe(true);
  expect(fetchMock).not.toHaveBeenCalled();
  buttons[1]!.click();
  await flush();
  expect(fetchMock).toHaveBeenCalledOnce();
  expect(fetchMock.mock.calls[0]![0]).toBe('/samples/outline.png');
  expect(inputError.textContent).toBe('');
  expect(decode).toHaveBeenCalledOnce();
});

it('サンプルの選択状態は成功時だけ切り替わり、読み込み中は現在の選択を保つ', async () => {
  const pending = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>()
    .mockResolvedValueOnce(new Response(new Blob(['sample'], { type: 'image/png' })))
    .mockReturnValueOnce(pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  setup();
  const buttons = [...document.querySelectorAll<HTMLButtonElement>('.image-sample')];
  expect(buttons.every(button => button.getAttribute('aria-pressed') === 'false')).toBe(true);
  buttons[1]!.click();
  await flush();
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
  buttons[2]!.click();
  await flush();
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('true');
  expect(buttons[2]!.getAttribute('aria-pressed')).toBe('false');
  pending.resolve(new Response(new Blob(['sample'], { type: 'image/png' })));
  await flush();
  expect(buttons[1]!.getAttribute('aria-pressed')).toBe('false');
  expect(buttons[2]!.getAttribute('aria-pressed')).toBe('true');
});

it('サンプル一覧はDOM順と位置を保ち、成功時だけ画面外の比較プレビューへスクロールする', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(new Blob(['sample'], { type: 'image/png' })));
  vi.stubGlobal('fetch', fetchMock);
  const { stage } = setup();
  const samples = document.querySelector<HTMLElement>('.image-samples')!;
  const buttons = [...samples.querySelectorAll<HTMLButtonElement>('.image-sample')];
  const parent = samples.parentElement;
  const nextSibling = samples.nextElementSibling;
  const scrollIntoView = vi.fn();
  Object.defineProperty(stage, 'scrollIntoView', { configurable: true, value: scrollIntoView });
  vi.stubGlobal('innerHeight', 100);
  Object.defineProperty(stage, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 110, bottom: 160, left: 0, right: 100, width: 100, height: 50, x: 0, y: 110, toJSON() {} }),
  });

  buttons[1]!.focus();
  buttons[1]!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
  await flush();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(scrollIntoView).toHaveBeenCalledWith({ block: 'end', inline: 'nearest' });
  expect(document.activeElement).toBe(buttons[1]);
  expect(samples.parentElement).toBe(parent);
  expect(samples.nextElementSibling).toBe(nextSibling);
  expect([...samples.querySelectorAll('.image-sample')]).toEqual(buttons);
  expect(samples.compareDocumentPosition(document.querySelector('.image-drop')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('.image-drop')!.compareDocumentPosition(document.querySelector('.image-comparison-area')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  const stagePosition = stage.compareDocumentPosition(document.querySelector('.image-view-tools')!);
  expect(stagePosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(document.querySelector('.image-view-tools')!.compareDocumentPosition(document.querySelector('.image-controls')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

  Object.defineProperty(stage, 'getBoundingClientRect', {
    configurable: true,
    value: () => ({ top: 10, bottom: 60, left: 0, right: 100, width: 100, height: 50, x: 0, y: 10, toJSON() {} }),
  });
  buttons[2]!.click();
  await flush();
  expect(scrollIntoView).toHaveBeenCalledOnce();

  const info = document.querySelector('.image-info')!.textContent;
  fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
  buttons[3]!.click();
  await flush();
  expect(scrollIntoView).toHaveBeenCalledOnce();
  expect(document.querySelector('.image-info')!.textContent).toBe(info);
});

it('後から始めたサンプル取得が先行する遅い取得より優先される', async () => {
  const first = deferred<Response>();
  const second = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>()
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  vi.stubGlobal('fetch', fetchMock);
  const { info } = setup();
  document.querySelector<HTMLButtonElement>('[data-sample="outline"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-sample="geometry"]')!.click();
  second.resolve(new Response(new Blob(['second'], { type: 'image/png' })));
  await flush();
  first.resolve(new Response(new Blob(['first'], { type: 'image/png' })));
  await flush();
  expect(decode).toHaveBeenCalledOnce();
  expect(vi.mocked(decode).mock.calls[0]![0].name).toBe('geometry.png');
  expect(info.textContent).toContain('geometry.png');
});

it('通常ファイル選択は未完了のサンプル取得を中止し、遅れて届いた応答に上書きされない', async () => {
  const pending = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  const { choose, info } = setup();
  document.querySelector<HTMLButtonElement>('[data-sample="outline"]')!.click();
  const signal = fetchMock.mock.calls[0]![1]?.signal;
  choose('user-file.png');
  expect(signal?.aborted).toBe(true);
  await flush();
  pending.resolve(new Response(new Blob(['stale'], { type: 'image/png' })));
  await flush();
  expect(decode).toHaveBeenCalledOnce();
  expect(vi.mocked(decode).mock.calls[0]![0].name).toBe('user-file.png');
  expect(info.textContent).toContain('user-file.png');
});

it('サンプル取得中にツールを離れると中止し、遅い応答から画面やデコードを更新しない', async () => {
  const pending = deferred<Response>();
  const fetchMock = vi.fn<typeof fetch>().mockReturnValue(pending.promise);
  vi.stubGlobal('fetch', fetchMock);
  const { inputError, unmount } = setup();
  const detachedAlert = inputError;
  document.querySelector<HTMLButtonElement>('[data-sample="geometry"]')!.click();
  const signal = fetchMock.mock.calls[0]![1]?.signal;
  unmount();
  expect(signal?.aborted).toBe(true);
  pending.resolve(new Response(new Blob(['stale'], { type: 'image/png' })));
  await flush();
  expect(decode).not.toHaveBeenCalled();
  expect(detachedAlert.textContent).toBe('');
  expect(document.body.childElementCount).toBe(0);
});

it('サンプル取得失敗時も現在のプレビューとダウンロード結果を保つ', async () => {
  const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetchMock);
  const { choose, info, left, right } = setup();
  choose('kept.png');
  await flush();
  const canvas = document.querySelector('canvas');
  const sourceInfo = info.textContent;
  document.querySelector<HTMLButtonElement>('[data-sample="outline"]')!.click();
  await flush();
  expect(document.querySelector('canvas')).toBe(canvas);
  expect(info.textContent).toBe(sourceInfo);
  expect(left.save.disabled).toBe(false);
  expect(right.save.disabled).toBe(false);
  expect(document.querySelector('.image-input-error')?.textContent).toContain('503');
});

it('SSIMULACRA2の目安表は閉じた状態で表示され、代表値と公式出典を案内する', () => {
  setup();
  const guide = document.querySelector<HTMLDetailsElement>('.image-score-guide')!;
  expect(guide.open).toBe(false);
  expect(guide.querySelector('summary')?.textContent).toBe('スコアの目安を見る');
  expect([...guide.querySelectorAll('tbody tr')].map(row => [...row.querySelectorAll('th, td')].map(cell => cell.textContent))).toEqual([
    ['100', '数学的にロスレス'],
    ['90', '視覚的にロスレス'],
    ['85', '極めて高画質'],
    ['80', '非常に高画質'],
    ['70', '高画質'],
    ['50', '中程度'],
    ['30', '低画質'],
    ['10', '非常に低画質'],
    ['0未満', '極端な画質劣化'],
  ]);
  expect(guide.querySelector('thead th')?.textContent).toBe('スコア');
  expect(guide.textContent).toContain('厳密な区間ではなく代表的な目安');
  expect(guide.textContent).toContain('高いほど元画像に近い');
  expect(guide.textContent).toContain('100点満点の採点方式ではありません');
  expect(guide.querySelector('a')?.getAttribute('href')).toBe('https://github.com/cloudinary/ssimulacra2#usage');
});

it('初期状態は左Original・右JPEG 0.75で、両側の元画像を再エンコードせず保存できる', async () => {
  const { choose, active, left, right, createUrl, download } = setup();
  const file = choose('input.alpha.png');
  await flush();
  expect(left.format.value).toBe('original');
  expect(right.format.value).toBe('image/jpeg');
  expect(right.slider.value).toBe('0.75');
  expect(decode).toHaveBeenCalledOnce();
  expect(encode).toHaveBeenCalledExactlyOnceWith(active, 'image/jpeg', 0.75);
  expect(left.output.textContent).toContain('0% 元 2 B → 出力 2 B');
  expect(left.output.dataset.change).toBe('same');
  expect(right.output.textContent).toContain('+100% 元 2 B → 出力 4 B');
  expect(right.output.dataset.change).toBe('increase');
  expect(document.querySelector('.image-info')?.textContent).toContain('元ファイル 2 B');

  right.select('original');
  expect(left.qualityLabel.hidden).toBe(true);
  expect(right.qualityLabel.hidden).toBe(true);
  expect(document.querySelector('.image-original-layer')?.classList.contains('image-original-left')).toBe(true);
  expect(document.querySelector('.image-original-layer')?.classList.contains('image-original-right')).toBe(true);
  expect(right.output.textContent).toContain('0% 元 2 B → 出力 2 B');
  expect(encode).toHaveBeenCalledOnce();
  expect(createUrl).toHaveBeenLastCalledWith(file);
  left.save.click();
  right.save.click();
  const anchors = download.mock.contexts as HTMLAnchorElement[];
  expect(anchors.map(anchor => anchor.download)).toEqual([file.name, file.name]);
  expect(anchors.map(anchor => anchor.href)).toEqual(['blob:result-1', 'blob:result-3']);
});

it('左右の出力形式はOriginalを先頭にし、表示名のアルファベット順で並ぶ', () => {
  const { left, right } = setup();
  const expected = [
    ['original', 'Original'],
    ['image/avif', 'AVIF (libaom)'],
    ['image/jpeg', 'Browser JPEG'],
    ['image/png', 'Browser PNG'],
    ['mozjpeg', 'JPEG (MozJPEG)'],
    ['image/jxl', 'JPEG XL (libjxl)'],
    ['oxipng', 'Oxipng'],
    ['image/webp', 'WebP (libwebp)'],
  ];

  for (const format of [left.format, right.format]) {
    expect([...format.options].map(option => [option.value, option.textContent])).toEqual(expected);
  }
});

it('KB表示はサイズだけを丸め、元ファイル比をバイト数から計算する', async () => {
  const { choose, left, right, info } = setup();
  vi.mocked(encode).mockResolvedValue(new Blob([new Uint8Array(1_250)], { type: 'image/jpeg' }));
  choose('large.png', undefined, new Uint8Array(1_000));
  await flush();

  expect(info.textContent).toContain('元ファイル 1 KB');
  expect(left.output.textContent).toBe('0% 元 1 KB → 出力 1 KB');
  expect(left.output.dataset.change).toBe('same');
  expect(right.output.textContent).toBe('+25% 元 1 KB → 出力 1.25 KB');
  expect(right.output.dataset.change).toBe('increase');
});

it('表示が+0%に丸まってもバイト数の増加方向を保持する', async () => {
  const { choose, right } = setup();
  vi.mocked(encode).mockResolvedValue(new Blob([new Uint8Array(1_000_001)], { type: 'image/jpeg' }));
  choose('large.png', undefined, new Uint8Array(1_000_000));
  await flush();

  expect(right.output.textContent).toBe('+0% 元 1 MB → 出力 1 MB');
  expect(right.output.dataset.change).toBe('increase');
});

it('不正な置換を保ち、同じ有効画像を再選択して比較を置き換える', async () => {
  const first = bitmap();
  const second = bitmap(30, 20);
  const { choose, input, active, left, right, info, section, inputError, createUrl, revokeUrl, change } = setup(first);
  choose('first.png');
  await flush();
  const previousLeft = left.preview.src;
  const previousRight = right.preview.src;

  Object.defineProperty(input, 'files', { configurable: true, value: [new File(['bad'], 'bad.gif', { type: 'image/gif' })] });
  input.dispatchEvent(new Event('change'));
  expect(input.value).toBe('');
  expect(inputError.textContent).toContain('JPEG・PNG・WebP');
  expect(info.textContent).toContain('first.png');
  expect(left.preview.src).toBe(previousLeft);
  expect(right.preview.src).toBe(previousRight);

  Object.defineProperty(input, 'files', { configurable: true, value: [
    new File(['one'], 'one.png', { type: 'image/png' }), new File(['two'], 'two.png', { type: 'image/png' }),
  ] });
  input.dispatchEvent(new Event('change'));
  expect(inputError.textContent).toContain('1枚ずつ');
  expect(info.textContent).toContain('first.png');
  expect(left.preview.src).toBe(previousLeft);

  vi.mocked(decode).mockRejectedValueOnce(new Error('壊れた画像'));
  choose('broken.png');
  await flush();
  expect(inputError.textContent).toContain('壊れた画像');
  expect(info.textContent).toContain('first.png');
  expect(left.preview.src).toBe(previousLeft);
  expect(createUrl).toHaveBeenCalledTimes(2);

  vi.mocked(decode).mockResolvedValueOnce(second);
  change.click();
  choose('second.png');
  await flush();
  expect(section.hidden).toBe(false);
  expect(document.querySelector('.image-drop')?.hasAttribute('hidden')).toBe(true);
  expect(info.textContent).toContain('second.png');
  expect(active.close).toHaveBeenCalledOnce();
  expect(revokeUrl).toHaveBeenCalledWith('blob:result-1');
  expect(revokeUrl).toHaveBeenCalledWith('blob:result-2');
  expect(inputError.textContent).toBe('');
});

it('品質を独立して保持し、変更した側だけを変換する', async () => {
  const { choose, active, left, right, download } = setup();
  choose();
  await flush();

  left.select('image/jpeg');
  await flush();
  expect(encode).toHaveBeenCalledOnce();
  const rightUrl = right.preview.src;
  left.quality('0.10');
  left.quality('0.25');
  expect(left.save.disabled).toBe(true);
  expect(right.save.disabled).toBe(false);
  expect(right.preview.src).toBe(rightUrl);
  expect(left.output.textContent).toBe('変換しています…');
  expect(right.output.textContent).toBe('+100% 元 2 B → 出力 4 B');
  left.save.click();
  right.save.click();
  expect(download).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(179);
  expect(encode).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(encode).toHaveBeenLastCalledWith(active, 'image/jpeg', 0.25);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(left.save.disabled).toBe(false);

  right.quality('1');
  await vi.advanceTimersByTimeAsync(180);
  expect(encode).toHaveBeenLastCalledWith(active, 'image/jpeg', 1);
  expect(left.slider.valueAsNumber).toBe(0.25);
  left.select('image/png');
  right.select('original');
  expect(left.qualityLabel.hidden).toBe(true);
  expect(right.qualityLabel.hidden).toBe(true);
  left.select('image/jpeg');
  right.select('image/jpeg');
  await flush();
  expect(left.slider.valueAsNumber).toBe(0.25);
  expect(right.slider.valueAsNumber).toBe(1);
  expect(encode).toHaveBeenLastCalledWith(active, 'image/jpeg', 1);
  expect(left.save.disabled).toBe(false);
  expect(right.save.disabled).toBe(false);
});

it('同じ設定の変換を共有し、成功結果のURLは左右で独立して解放する', async () => {
  const { choose, left, right, createUrl, revokeUrl } = setup();
  choose();
  await flush();
  const encoding = deferred<Blob>();
  vi.mocked(encode).mockReturnValueOnce(encoding.promise);
  left.select('image/png');
  right.select('image/png');
  expect(encode).toHaveBeenCalledTimes(2);
  encoding.resolve(png);
  await flush();
  expect(createUrl.mock.calls.slice(-2)).toEqual([[png], [png]]);
  expect(left.output.textContent).toContain('-50% 元 2 B → 出力 1 B');
  expect(right.output.textContent).toBe(left.output.textContent);
  const leftUrl = left.preview.src;
  const rightUrl = right.preview.src;
  left.select('original');
  expect(revokeUrl).toHaveBeenCalledWith(leftUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(rightUrl);
  expect(right.preview.src).toBe(rightUrl);
  expect(left.output.textContent).toBe('0% 元 2 B → 出力 2 B');
  expect(right.output.textContent).toBe('-50% 元 2 B → 出力 1 B');
});

it('左右の設定変更が重なっても古いエンコードとプレビュー結果を破棄する', async () => {
  const { choose, left, right, createUrl, revokeUrl } = setup();
  choose();
  await flush();
  const staleEncode = deferred<Blob>();
  const stalePreview = deferred<void>();
  vi.mocked(encode).mockReturnValueOnce(staleEncode.promise);
  right.quality('0.50');
  await vi.advanceTimersByTimeAsync(180);
  left.decodePreview.mockReturnValueOnce(stalePreview.promise);
  left.select('image/png');
  await flush();
  const staleUrl = left.preview.src;
  right.quality('0.51');
  right.quality('0.52');
  left.select('image/jpeg');
  await vi.advanceTimersByTimeAsync(180);
  const leftUrl = left.preview.src;
  const rightUrl = right.preview.src;
  const urlsCreated = createUrl.mock.calls.length;
  staleEncode.resolve(jpeg);
  stalePreview.reject(new DOMException('superseded'));
  await flush();
  expect(revokeUrl).toHaveBeenCalledWith(staleUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(leftUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(rightUrl);
  expect(createUrl).toHaveBeenCalledTimes(urlsCreated);
  expect(left.preview.src).toBe(leftUrl);
  expect(right.preview.src).toBe(rightUrl);
  expect(left.error.textContent).toBe('');
  expect(right.error.textContent).toBe('');
  expect(left.save.disabled).toBe(false);
  expect(right.save.disabled).toBe(false);
  expect(left.output.textContent).toBe('+100% 元 2 B → 出力 4 B');
  expect(right.output.textContent).toBe(left.output.textContent);
});

it('連続入力・ドロップ・ツール破棄で古いデコードと変換を無効化する', async () => {
  const { choose, comparisonArea, active, left, right, getCanvas, info, createUrl, revokeUrl, unmount } = setup();
  const staleDecode = deferred<ImageBitmap>();
  const staleEncode = deferred<Blob>();
  const pendingOnUnmount = deferred<Blob>();
  const old = bitmap();
  const replacement = bitmap();
  vi.mocked(decode).mockReturnValueOnce(staleDecode.promise).mockResolvedValueOnce(active).mockResolvedValueOnce(replacement);
  vi.mocked(encode).mockReturnValueOnce(staleEncode.promise).mockReturnValueOnce(pendingOnUnmount.promise);

  choose('old.png');
  const oldSignal = vi.mocked(decode).mock.calls[0]![1];
  choose('middle.png');
  expect(oldSignal.aborted).toBe(true);
  await flush();
  expect(info.textContent).toContain('middle.png');
  staleDecode.resolve(old);
  await flush();
  expect(old.close).toHaveBeenCalledOnce();

  choose('new.png', comparisonArea);
  await flush();
  expect(active.close).toHaveBeenCalledOnce();
  expect(revokeUrl).toHaveBeenCalledWith('blob:result-1');
  await flush();
  expect(info.textContent).toContain('new.png');
  staleEncode.resolve(jpeg);
  await flush();
  expect(createUrl).toHaveBeenCalledTimes(2);
  expect(right.save.disabled).toBe(true);

  left.select('image/jpeg');
  left.quality('0.24');
  const canvasBeforeUnmount = getCanvas();
  unmount();
  left.select('image/png');
  right.quality('0.56');
  choose('ignored.png', comparisonArea);
  pendingOnUnmount.resolve(jpeg);
  await vi.runAllTimersAsync();
  expect(revokeUrl.mock.calls).toEqual([['blob:result-1'], ['blob:result-2']]);
  expect(replacement.close).toHaveBeenCalledOnce();
  expect(canvasBeforeUnmount.width).toBe(0);
  expect(decode).toHaveBeenCalledTimes(3);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(document.body.childElementCount).toBe(0);
});

function mockScoring() {
  class ScoringWorker {
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    terminate = vi.fn();
    postMessage = vi.fn();
    constructor() { workers.push(this); }
    reply(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
  }
  const workers: ScoringWorker[] = [];
  const copy = vi.fn(async () => bitmap());
  vi.stubGlobal('Worker', ScoringWorker);
  vi.stubGlobal('createImageBitmap', copy);
  return { workers, copy };
}

it('置換のデコード中は現在の結果と採点を維持し、置換確定で古いWorkerとスコアを失効させる', async () => {
  const { choose, evaluate, left, right, info, auto } = setup();
  const { workers } = mockScoring();
  auto.checked = false;
  auto.dispatchEvent(new Event('change'));
  choose('first.png');
  await flush();
  evaluate.click();
  await flush();
  workers[0]!.reply({ index: 0, score: 88.25 });
  await flush();
  expect(right.score.textContent).toBe('88.3');

  left.select('image/jpeg');
  await flush();
  vi.mocked(encode).mockResolvedValueOnce(new Blob(['new jpeg'], { type: 'image/jpeg' }));
  left.quality('0.50');
  await vi.advanceTimersByTimeAsync(180);
  evaluate.click();
  await flush();
  const activeWorker = workers[1]!;
  expect(activeWorker.terminate).not.toHaveBeenCalled();
  const candidate = deferred<ImageBitmap>();
  vi.mocked(decode).mockReturnValueOnce(candidate.promise);
  choose('replacement.png');
  expect(info.textContent).toContain('first.png');
  expect(right.score.textContent).toBe('88.3');
  expect(activeWorker.terminate).not.toHaveBeenCalled();

  const replacement = bitmap(30, 20);
  candidate.resolve(replacement);
  await flush();
  expect(info.textContent).toContain('replacement.png');
  expect(activeWorker.terminate).toHaveBeenCalledOnce();
  expect(right.score.textContent).toBe('画質は未評価');
});

it('ツール破棄で候補デコードを中止し、遅れて届いたビットマップを閉じる', async () => {
  const { choose, unmount } = setup();
  const pending = deferred<ImageBitmap>();
  const late = bitmap();
  vi.mocked(decode).mockReturnValueOnce(pending.promise);
  choose('pending.png');
  const signal = vi.mocked(decode).mock.calls[0]![1];
  unmount();
  expect(signal.aborted).toBe(true);
  pending.resolve(late);
  await flush();
  expect(late.close).toHaveBeenCalledOnce();
  expect(document.body.childElementCount).toBe(0);
});

it('OriginalとPNGを説明し、JPEG出力が準備できるまで評価できない', async () => {
  const { choose, evaluate, left, right } = setup();
  const { workers } = mockScoring();
  const preparing = deferred<Blob>();
  vi.mocked(encode).mockReturnValueOnce(preparing.promise);
  choose();
  await flush();
  expect(left.score.textContent).toBe('基準画像');
  await vi.advanceTimersByTimeAsync(799);
  expect(workers).toHaveLength(0);
  preparing.resolve(jpeg);
  await flush();
  expect(evaluate.disabled).toBe(false);
  right.select('image/png');
  await vi.advanceTimersByTimeAsync(800);
  expect(right.score.textContent).toBe('画質評価は未対応');
  expect(evaluate.disabled).toBe(true);
  expect(right.save.disabled).toBe(false);
  expect(workers).toHaveLength(0);
});

it('片側のJPEG変換が失敗しても、出力済みの反対側を採点できる', async () => {
  const { choose, evaluate, left, right } = setup();
  const { workers } = mockScoring();
  choose();
  await flush();
  left.select('image/jpeg');
  await flush();
  const encoding = deferred<Blob>();
  vi.mocked(encode).mockReturnValueOnce(encoding.promise);
  left.quality('0.35');
  await vi.advanceTimersByTimeAsync(180);
  evaluate.click();
  await flush();
  expect(workers).toHaveLength(0);
  encoding.reject(new Error('変換に失敗しました。'));
  await flush();
  expect(left.error.textContent).toContain('変換に失敗');
  expect(right.save.disabled).toBe(false);
  expect(evaluate.disabled).toBe(true);
  expect(workers[0]!.postMessage.mock.calls[0]![0].images).toEqual([jpeg]);
});

it.each([[7, 8, '各辺8 px'], [2500, 4001, '10,000,000画素']])(
  '採点の寸法制限 %i×%i でも通常変換と保存が使える', async (width, height, reason) => {
    const { choose, evaluate, limit, right, download } = setup(bitmap(width, height));
    const { copy, workers } = mockScoring();
    choose();
    await flush();
    expect(limit.textContent).toContain(reason);
    expect(evaluate.disabled).toBe(true);
    evaluate.click();
    await vi.advanceTimersByTimeAsync(800);
    expect(copy).not.toHaveBeenCalled();
    expect(workers).toHaveLength(0);
    right.save.click();
    expect(download).toHaveBeenCalledOnce();
  },
);

it('左右で同じJPEG Blobを採点するのは一度で、別のBlobに変わった側だけ無効にする', async () => {
  const { active, choose, evaluate, left, right, evaluationStatus } = setup();
  const { workers, copy } = mockScoring();
  choose();
  await flush();
  left.select('image/jpeg');
  await flush();
  evaluate.click();
  await flush();
  const [worker] = workers;
  expect(copy).toHaveBeenCalledWith(active);
  const duplicate = await copy.mock.results[0]!.value;
  expect(worker!.postMessage).toHaveBeenCalledWith({ reference: duplicate, images: [jpeg] }, [duplicate]);
  worker!.reply({ index: 0, score: 101.234 });
  await flush();
  expect(left.score.textContent).toBe('101.2');
  expect(right.score.textContent).toBe(left.score.textContent);
  expect(worker!.terminate).toHaveBeenCalledOnce();
  expect(evaluationStatus.textContent).toContain('完了');
  expect(evaluate.disabled).toBe(true);

  const changed = new Blob(['changed'], { type: 'image/jpeg' });
  vi.mocked(encode).mockResolvedValueOnce(changed);
  left.quality('0.25');
  expect(left.score.textContent).not.toContain('101.2');
  expect(right.score.textContent).toBe('101.2');
  await vi.advanceTimersByTimeAsync(180);
  expect(workers).toHaveLength(1);
  evaluate.click();
  await flush();
  expect(workers[1]!.postMessage.mock.calls[0]![0].images).toEqual([changed]);
  workers[1]!.reply({ index: 0, score: 75 });
  await flush();
  left.quality('0.75');
  await vi.advanceTimersByTimeAsync(800);
  expect(left.score.textContent).toBe(right.score.textContent);
  expect(evaluate.disabled).toBe(true);
  expect(workers).toHaveLength(2);

  choose('new-reference.png');
  await vi.advanceTimersByTimeAsync(800);
  expect(workers[2]!.postMessage.mock.calls[0]![0].images).toEqual([jpeg]);
});

it('中止後に再実行でき、画像切り替えとツール破棄は実行中のWorkerを終了する', async () => {
  const { choose, evaluate, cancel, evaluationStatus, right, unmount } = setup();
  const { workers } = mockScoring();
  choose('first.png');
  await vi.advanceTimersByTimeAsync(800);
  const stale = workers[0]!.onmessage!;
  cancel.click();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  expect(evaluationStatus.textContent).toContain('中止');
  expect(evaluate.disabled).toBe(false);
  await vi.advanceTimersByTimeAsync(1600);
  expect(workers).toHaveLength(1);

  evaluate.click();
  await flush();
  const oldImage = workers[1]!.onmessage!;
  choose('second.png');
  await flush();
  expect(workers[1]!.terminate).toHaveBeenCalledOnce();
  evaluate.click();
  await flush();
  for (const reply of [stale, oldImage]) reply(new MessageEvent('message', { data: { index: 0, score: 99 } }));
  expect(right.score.textContent).not.toContain('99');
  expect(evaluationStatus.textContent).toContain('評価しています');
  unmount();
  expect(workers[2]!.terminate).toHaveBeenCalledOnce();
});

it('画像の複製待ちに設定が変更されたときは、遅れて届いた複製を解放する', async () => {
  const { choose, evaluate, right } = setup();
  const { workers, copy } = mockScoring();
  const pending = deferred<ImageBitmap>();
  const duplicate = bitmap();
  copy.mockReturnValueOnce(pending.promise);
  choose();
  await flush();
  evaluate.click();
  await flush();
  right.quality('0.32');
  pending.resolve(duplicate);
  await flush();
  expect(duplicate.close).toHaveBeenCalledOnce();
  expect(workers).toHaveLength(0);
});

it('Wasmロード失敗と非有限の結果から復帰し、変換・保存は利用できる', async () => {
  const { choose, evaluate, evaluationStatus, right, download } = setup();
  const { workers } = mockScoring();
  choose();
  await vi.advanceTimersByTimeAsync(800);
  for (const data of [{ error: true }, { index: 0, score: Infinity }]) {
    const worker = workers.at(-1)!;
    worker.reply(data);
    const count = workers.length;
    await vi.advanceTimersByTimeAsync(1600);
    expect(workers).toHaveLength(count);
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(evaluationStatus.textContent).toContain('評価できませんでした');
    expect(right.error.textContent).toBe('');
    expect(right.save.disabled).toBe(false);
    evaluate.click();
    await flush();
  }
  right.save.click();
  expect(download).toHaveBeenCalledOnce();
  workers[2]!.reply({ index: 0, score: -14.3 });
  await flush();
  expect(right.score.textContent).toBe('-14.3');
  expect(evaluationStatus.textContent).toContain('完了');
});

it('初回の画像選択から800msで自動評価を開始する', async () => {
  const { auto, choose, right, evaluationStatus } = setup(bitmap(2048, 2048));
  const { workers } = mockScoring();
  const reading = deferred<ImageBitmap>();
  vi.mocked(decode).mockReturnValueOnce(reading.promise);
  expect(auto.checked).toBe(true);
  choose();
  await vi.advanceTimersByTimeAsync(300);
  reading.resolve(bitmap(2048, 2048));
  await flush();
  expect(right.save.disabled).toBe(false);
  expect(evaluationStatus.textContent).toContain('待機');
  await vi.advanceTimersByTimeAsync(499);
  expect(workers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(workers).toHaveLength(1);
  expect(evaluationStatus.textContent).toContain('評価しています');
  workers[0]!.reply({ index: 0, score: 82 });
  await flush();
  expect(right.score.textContent).toBe('82.0');
});

it('採点中の変更で古いWorkerを止め、連続操作の最後の品質だけを自動評価する', async () => {
  const { choose, left, right, evaluationStatus } = setup();
  const { workers } = mockScoring();
  choose();
  await vi.advanceTimersByTimeAsync(800);
  workers[0]!.reply({ index: 0, score: 85 });
  await flush();

  const first = new Blob(['first']);
  const last = new Blob(['last']);
  vi.mocked(encode).mockResolvedValueOnce(first).mockResolvedValueOnce(last);
  left.select('image/jpeg');
  await flush();
  expect(left.score.textContent).toBe('85.0');
  left.quality('0.35');
  expect(left.score.textContent).toBe('変換待ち…');
  await vi.advanceTimersByTimeAsync(800);
  const oldWorker = workers[1]!;
  expect(oldWorker.postMessage.mock.calls[0]![0].images).toEqual([first]);
  const lateReply = oldWorker.onmessage!;

  left.quality('0.45');
  expect(oldWorker.terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(150);
  left.quality('0.55');
  await vi.advanceTimersByTimeAsync(150);
  left.quality('0.65');
  await vi.advanceTimersByTimeAsync(799);
  expect(encode).toHaveBeenCalledTimes(3);
  expect(vi.mocked(encode).mock.lastCall?.[2]).toBe(0.65);
  expect(workers).toHaveLength(2);
  expect(evaluationStatus.textContent).toContain('待機');
  expect(left.score.textContent).toBe('評価待機中…');
  expect(right.score.textContent).toBe('85.0');

  await vi.advanceTimersByTimeAsync(1);
  expect(workers[2]!.postMessage.mock.calls[0]![0].images).toEqual([last]);
  lateReply(new MessageEvent('message', { data: { index: 0, score: 42 } }));
  expect(left.score.textContent).toBe('評価中…');
  workers[2]!.reply({ index: 0, score: 83 });
  await flush();
  expect(left.score.textContent).toBe('83.0');
  expect(right.score.textContent).toBe('85.0');
});

it.each(['auto', 'manual'])('JPEGとプレビューの完了を待ってから%s評価する', async mode => {
  const { choose, evaluate, right, evaluationStatus } = setup();
  const { workers } = mockScoring();
  const encoding = deferred<Blob>();
  const preview = deferred<void>();
  vi.mocked(encode).mockReturnValueOnce(encoding.promise);
  right.decodePreview.mockReturnValueOnce(preview.promise);
  choose();
  await flush();
  if (mode === 'manual') evaluate.click();
  await vi.advanceTimersByTimeAsync(mode === 'auto' ? 1000 : 100);
  expect(workers).toHaveLength(0);
  encoding.resolve(jpeg);
  await flush();
  expect(workers).toHaveLength(0);
  expect(evaluationStatus.textContent).toContain('待機');
  preview.resolve(undefined);
  await flush();
  expect(workers).toHaveLength(1);
  expect(workers[0]!.postMessage.mock.calls[0]![0].images).toEqual([jpeg]);
});

it('自動評価をオフにすると待機と実行を止め、手動評価は継続できる', async () => {
  const { auto, choose, evaluate, right, evaluationStatus } = setup();
  const { workers } = mockScoring();
  choose();
  await flush();
  auto.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(0);
  right.quality('0.25');
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(0);

  auto.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  auto.click();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(evaluationStatus.textContent).toContain('中止');

  evaluate.click();
  await flush();
  auto.click();
  auto.click();
  expect(workers).toHaveLength(2);
  expect(workers[1]!.terminate).not.toHaveBeenCalled();
  workers[1]!.reply({ index: 0, score: 65 });
  await flush();
  expect(right.score.textContent).toBe('65.0');
});

it('待機中の中止は同じ設定で再開せず、入力変更とツール破棄は古い待機を消す', async () => {
  const { choose, cancel, right, evaluationStatus, unmount } = setup();
  const { workers } = mockScoring();
  choose();
  await flush();
  cancel.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(evaluationStatus.textContent).toContain('中止');
  expect(workers).toHaveLength(0);

  right.quality('0.25');
  await vi.advanceTimersByTimeAsync(400);
  choose('replacement.png');
  await vi.advanceTimersByTimeAsync(799);
  expect(workers).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(workers).toHaveLength(1);
  right.quality('0.55');
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  unmount();
  await vi.runAllTimersAsync();
  expect(workers).toHaveLength(1);
});

it('前のWorkerの終了を待って起動し、待機中の中止で古い要求を破棄する', async () => {
  const { choose, right, cancel, evaluationStatus } = setup();
  const { workers, copy } = mockScoring();
  const retiring = deferred<void>();
  const request = vi.fn<(
    name: string, options: { signal: AbortSignal }, callback: () => void,
  ) => Promise<void>>().mockResolvedValue(undefined).mockReturnValueOnce(Promise.resolve()).mockReturnValueOnce(retiring.promise);
  vi.stubGlobal('navigator', { locks: { request } });
  choose();
  await vi.advanceTimersByTimeAsync(800);
  const [name] = request.mock.calls[0]!;
  expect(workers[0]!.postMessage.mock.calls[0]![0].lockName).toBe(name);

  right.quality('0.35');
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(800);
  const [nextName, waiting] = request.mock.calls[1]!;
  expect(nextName).toBe(name);
  expect(evaluationStatus.textContent).toContain('待機');
  expect(workers).toHaveLength(1);
  expect(copy).toHaveBeenCalledOnce();
  cancel.click();
  expect(waiting.signal.aborted).toBe(true);
  retiring.resolve(undefined);
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(evaluationStatus.textContent).toContain('中止');

  right.quality('0.25');
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(2);
});

it('Oxipngの設定は左右で独立し、形式を切り替えてもその側の設定を保持する', async () => {
  const { choose, left, right } = setup();
  choose();
  await flush();
  left.select('oxipng');
  left.oxipngLevel.value = '5';
  left.oxipngLevel.dispatchEvent(new Event('change'));
  left.oxipngInterlace.checked = true;
  left.oxipngInterlace.dispatchEvent(new Event('change'));
  left.oxipngAlpha.checked = true;
  left.oxipngAlpha.dispatchEvent(new Event('change'));
  right.select('oxipng');
  await flush();

  expect(left.oxipngSettings.hidden).toBe(false);
  expect(left.oxipngLevel.value).toBe('5');
  expect(left.oxipngInterlace.checked).toBe(true);
  expect(left.oxipngAlpha.checked).toBe(true);
  expect(right.oxipngLevel.value).toBe('2');
  expect(right.oxipngInterlace.checked).toBe(false);
  expect(right.oxipngAlpha.checked).toBe(false);
  expect(left.score.textContent).toBe('可逆圧縮（スコア評価対象外）');
  left.select('image/png');
  expect(left.oxipngSettings.hidden).toBe(true);
  left.select('oxipng');
  expect(left.oxipngLevel.value).toBe('5');
});

it('同じ入力・Oxipng設定の左右は実行中のBlobを共有する', async () => {
  const { choose, left, right, createUrl } = setup();
  const pending = deferred<Blob>();
  vi.mocked(encodeOxipng).mockImplementation((_bitmap, _options, _signal, onStart) => {
    onStart();
    return pending.promise;
  });
  choose('sample.png');
  await flush();
  left.select('oxipng');
  await flush();
  right.select('oxipng');
  await flush();
  expect(vi.mocked(encodeOxipng)).toHaveBeenCalledOnce();
  expect(left.oxipngStatus.textContent).toContain('変換しています');
  expect(right.oxipngStatus.textContent).toContain('変換しています');

  pending.resolve(oxipngPng);
  await flush();
  expect(left.save.disabled).toBe(false);
  expect(right.save.disabled).toBe(false);
  expect(left.oxipngStatus.textContent).toContain('完了');
  expect(right.oxipngStatus.textContent).toContain('完了');
  expect(createUrl.mock.calls.filter(([blob]) => blob === oxipngPng)).toHaveLength(2);
});

it('Oxipng level, interlace and alpha settings debounce for 180ms', async () => {
  const { choose, left } = setup();
  choose();
  await flush();
  left.select('oxipng');
  await flush();
  expect(encodeOxipng).toHaveBeenCalledOnce();

  left.oxipngLevel.value = '3';
  left.oxipngLevel.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeOxipng).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(encodeOxipng).toHaveBeenCalledTimes(2);

  left.oxipngInterlace.checked = true;
  left.oxipngInterlace.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeOxipng).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(encodeOxipng).toHaveBeenCalledTimes(3);

  left.oxipngAlpha.checked = true;
  left.oxipngAlpha.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeOxipng).toHaveBeenCalledTimes(3);
  await vi.advanceTimersByTimeAsync(1);
  expect(encodeOxipng).toHaveBeenCalledTimes(4);
});

it('共有中のOxipngは最後の側が中止するまで生き、片側の中止後に再試行できる', async () => {
  const { choose, left, right } = setup();
  const pending = deferred<Blob>();
  let signal!: AbortSignal;
  vi.mocked(encodeOxipng).mockImplementation((_bitmap, _options, activeSignal) => {
    signal = activeSignal;
    return pending.promise;
  });
  choose();
  await flush();
  left.select('oxipng');
  right.select('oxipng');
  await flush();
  right.oxipngCancel.click();
  expect(signal.aborted).toBe(false);
  expect(right.oxipngRetry.hidden).toBe(false);
  expect(right.save.disabled).toBe(true);
  left.oxipngCancel.click();
  expect(signal.aborted).toBe(true);

  vi.mocked(encodeOxipng).mockRejectedValueOnce(new Error('worker failed')).mockResolvedValueOnce(oxipngPng);
  left.oxipngRetry.click();
  await flush();
  expect(left.oxipngRetry.hidden).toBe(false);
  expect(left.save.disabled).toBe(true);
  left.oxipngRetry.click();
  await flush();
  expect(left.save.disabled).toBe(false);
  expect(left.oxipngStatus.textContent).toContain('完了');
});

it('AVIF controls start at the specified values, debounce changes and restore lossy values after lossless mode', async () => {
  const { choose, left, right } = setup();
  choose();
  await flush();
  left.select('image/avif');
  await flush();
  expect(left.avifSettings.hidden).toBe(false);
  expect([left.avifQuality.value, left.avifAlpha.value, left.avifSpeed.value, left.avifSubsample.value, left.avifLossless.checked])
    .toEqual(['50', '100', '6', '1', false]);
  expect([right.avifQuality.value, right.avifAlpha.value, right.avifSpeed.value, right.avifSubsample.value, right.avifLossless.checked])
    .toEqual(['50', '100', '6', '1', false]);
  expect(encodeAvif).toHaveBeenCalledWith(expect.anything(), { quality: 50, qualityAlpha: 100, speed: 6, subsample: 1, lossless: false }, expect.anything(), expect.any(Function));

  left.setRange(left.avifQuality, 80);
  left.setRange(left.avifSpeed, 4);
  left.avifSubsample.value = '3';
  left.avifSubsample.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeAvif).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(encodeAvif).toHaveBeenCalledTimes(2);
  expect(vi.mocked(encodeAvif).mock.lastCall?.[1]).toEqual({ quality: 80, qualityAlpha: 100, speed: 4, subsample: 3, lossless: false });

  left.avifLossless.checked = true;
  left.avifLossless.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(180);
  await flush();
  expect([left.avifQuality.value, left.avifAlpha.value, left.avifSubsample.value]).toEqual(['100', '100', '3']);
  expect(left.avifQuality.disabled).toBe(true);
  expect(left.avifAlpha.disabled).toBe(true);
  expect(left.avifSubsample.disabled).toBe(true);
  expect(vi.mocked(encodeAvif).mock.lastCall?.[1]).toEqual({ quality: 80, qualityAlpha: 100, speed: 4, subsample: 3, lossless: true });

  left.avifLossless.checked = false;
  left.avifLossless.dispatchEvent(new Event('change'));
  await vi.advanceTimersByTimeAsync(180);
  await flush();
  expect([left.avifQuality.value, left.avifAlpha.value, left.avifSpeed.value, left.avifSubsample.value]).toEqual(['80', '100', '4', '3']);
  expect(left.avifQuality.disabled).toBe(false);
  expect(right.avifSettings.hidden).toBe(true);
});

it('AVIF changes only the selected side, shares equal settings, and keeps a shared job until its last consumer cancels', async () => {
  const { choose, left, right } = setup();
  vi.mocked(encodeAvif).mockImplementation((_bitmap, _options, _signal, onStart) => {
    onStart();
    return deferredAvif.promise;
  });
  const deferredAvif = deferred<Blob>();
  choose();
  await flush();
  left.select('image/avif');
  right.select('image/avif');
  await flush();
  expect(encodeAvif).toHaveBeenCalledOnce();
  expect(left.avifStatus.textContent).toContain('変換しています');
  expect(right.avifStatus.textContent).toContain('変換しています');
  const signal = vi.mocked(encodeAvif).mock.calls[0]![2];
  right.avifCancel.click();
  expect(signal.aborted).toBe(false);
  expect(right.avifRetry.hidden).toBe(false);
  expect(left.save.disabled).toBe(true);
  left.avifCancel.click();
  expect(signal.aborted).toBe(true);
  expect(left.avifRetry.hidden).toBe(false);
});

it('AVIFの共有ジョブは両側へ同じBlobを反映し、設定変更後の古い結果を捨てる', async () => {
  const { choose, left, right, createUrl } = setup();
  const shared = deferred<Blob>();
  vi.mocked(encodeAvif).mockImplementationOnce(() => shared.promise);
  choose();
  await flush();
  left.select('image/avif');
  right.select('image/avif');
  await flush();
  expect(encodeAvif).toHaveBeenCalledOnce();
  shared.resolve(avif);
  await flush();
  expect(createUrl.mock.calls.slice(-2).map(call => call[0])).toEqual([avif, avif]);
  expect(left.preview.src).not.toBe(right.preview.src);

  const stale = deferred<Blob>();
  const replacement = new Blob(['replacement'], { type: 'image/avif' });
  vi.mocked(encodeAvif).mockImplementationOnce(() => stale.promise).mockResolvedValueOnce(replacement);
  left.setRange(left.avifQuality, 80);
  await vi.advanceTimersByTimeAsync(180);
  const staleSignal = vi.mocked(encodeAvif).mock.calls.at(-1)![2];
  left.setRange(left.avifQuality, 81);
  await vi.advanceTimersByTimeAsync(180);
  await flush();
  const displayedUrl = left.preview.src;
  const urlCount = createUrl.mock.calls.length;
  stale.resolve(avif);
  await flush();
  expect(staleSignal.aborted).toBe(true);
  expect(createUrl).toHaveBeenCalledTimes(urlCount);
  expect(left.preview.src).toBe(displayedUrl);
});

it('AVIFの実行中に入力世代が変わった場合、古いBlobを表示せず、破棄時にWorkerを中止する', async () => {
  const { choose, left, unmount, createUrl } = setup();
  const oldResult = deferred<Blob>();
  const current = new Blob(['current'], { type: 'image/avif' });
  vi.mocked(encodeAvif).mockImplementationOnce(() => oldResult.promise).mockResolvedValueOnce(current);
  choose('first.png');
  await flush();
  left.select('image/avif');
  await flush();
  const oldSignal = vi.mocked(encodeAvif).mock.calls[0]![2];
  choose('second.png');
  await flush();
  oldResult.resolve(avif);
  await flush();
  expect(oldSignal.aborted).toBe(true);
  expect(createUrl.mock.calls.some(([blob]) => blob === avif)).toBe(false);
  left.select('image/avif');
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === current)).toBe(true);

  const pending = deferred<Blob>();
  vi.mocked(encodeAvif).mockImplementationOnce(() => pending.promise);
  left.setRange(left.avifQuality, 82);
  await vi.advanceTimersByTimeAsync(180);
  const pendingSignal = vi.mocked(encodeAvif).mock.calls.at(-1)![2];
  unmount();
  expect(pendingSignal.aborted).toBe(true);
  pending.resolve(avif);
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === avif)).toBe(false);
});

it('非可逆AVIFをSSIMULACRA2へ渡し、可逆AVIFは採点対象から除外する', async () => {
  const { choose, left, right, evaluate, auto } = setup();
  const { workers } = mockScoring();
  auto.checked = false;
  auto.dispatchEvent(new Event('change'));
  choose();
  await flush();
  right.select('original');
  left.select('image/avif');
  await flush();
  evaluate.click();
  await flush();
  expect(workers).toHaveLength(1);
  expect(workers[0]!.postMessage.mock.calls[0]![0].images).toEqual([avif]);
  workers[0]!.reply({ index: 0, score: 84.2 });
  await flush();
  expect(left.score.textContent).toBe('84.2');

  left.avifLossless.checked = true;
  left.avifLossless.dispatchEvent(new Event('change'));
  await flush();
  expect(left.score.textContent).toContain('スコア評価対象外');
  evaluate.click();
  await flush();
  expect(workers).toHaveLength(1);
});

it('失敗した唯一のAVIFは自動評価予約を破棄し、再試行後に評価を再開する', async () => {
  const { choose, left, right, auto } = setup();
  const { workers } = mockScoring();
  vi.mocked(encodeAvif).mockRejectedValueOnce(new Error('temporary failure')).mockResolvedValueOnce(avif);
  auto.checked = true;
  choose();
  await flush();
  left.select('image/avif');
  right.select('original');
  await flush();
  expect(left.avifStatus.textContent).toContain('失敗');
  expect(workers).toHaveLength(0);
  left.avifRetry.click();
  await flush();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers).toHaveLength(1);
  expect(workers[0]!.postMessage.mock.calls[0]![0].images).toEqual([avif]);
});

it('WebP keeps per-side and per-mode settings when changing output formats', async () => {
  const { choose, left, right } = setup();
  choose();
  await flush();
  left.select('image/webp');
  right.select('image/webp');
  await flush();
  left.setRange(left.webpQuality, 83);
  left.setRange(left.webpAlpha, 60);
  left.webpSharp.click();
  left.webpLossless.click();
  expect(left.webpQuality.getAttribute('aria-label')).toBe('左の圧縮効率');
  expect(left.webpQuality.value).toBe('75');
  expect(left.webpAlpha.disabled).toBe(true);
  expect(left.webpSharp.disabled).toBe(true);
  left.setRange(left.webpQuality, 98);
  left.setRange(left.webpMethod, 5);
  expect(right.webpQuality.value).toBe('75');
  expect(right.webpAlpha.value).toBe('100');
  expect(right.webpMethod.value).toBe('4');
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeWebp).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(encodeWebp).toHaveBeenCalledTimes(2);
  expect(vi.mocked(encodeWebp).mock.calls[1]![1]).toMatchObject({ lossless: true, losslessQuality: 98, method: 5 });
  left.select('image/png');
  left.select('image/webp');
  await flush();
  expect(left.webpQuality.value).toBe('98');
  left.webpLossless.click();
  expect(left.webpQuality.value).toBe('83');
  expect(left.webpAlpha.value).toBe('60');
  expect(left.webpSharp.checked).toBe(true);
});

it('WebP shares jobs and blobs by effective settings and aborts after the last pending side leaves', async () => {
  const { choose, left, right, createUrl, unmount } = setup();
  const pending = deferred<Blob>();
  vi.mocked(encodeWebp).mockImplementationOnce(() => pending.promise);
  left.select('image/webp');
  right.select('image/webp');
  left.setRange(left.webpQuality, 53);
  right.setRange(right.webpAlpha, 37);
  left.webpLossless.click();
  right.webpLossless.click();
  choose();
  await flush();
  expect(encodeWebp).toHaveBeenCalledOnce();
  const signal = vi.mocked(encodeWebp).mock.calls[0]![2];
  left.webpCancel.click();
  expect(signal.aborted).toBe(false);
  right.webpCancel.click();
  expect(signal.aborted).toBe(true);
  const stale = new Blob(['stale'], { type: 'image/webp' });
  pending.resolve(stale);
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === stale)).toBe(false);
  left.webpRetry.click();
  await flush();
  right.webpRetry.click();
  await flush();
  expect(encodeWebp).toHaveBeenCalledTimes(2);
  expect(createUrl.mock.calls.slice(-2).map(([blob]) => blob)).toEqual([webp, webp]);
  left.select('original');
  right.select('original');
  right.select('image/webp');
  await flush();
  expect(encodeWebp).toHaveBeenCalledTimes(3);

  const replacement = deferred<Blob>();
  vi.mocked(encodeWebp).mockImplementationOnce(() => replacement.promise);
  choose('replacement.png');
  await flush();
  const replacementSignal = vi.mocked(encodeWebp).mock.calls[3]![2];
  unmount();
  expect(replacementSignal.aborted).toBe(true);
  replacement.resolve(stale);
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === stale)).toBe(false);
});

it('WebP drops queued and late results after input and settings changes', async () => {
  const { choose, left, createUrl } = setup();
  const oldInput = deferred<Blob>();
  const oldSettings = deferred<Blob>();
  vi.mocked(encodeWebp)
    .mockImplementationOnce(() => oldInput.promise)
    .mockImplementationOnce(() => oldSettings.promise);
  left.select('image/webp');
  choose('first.png');
  await flush();
  choose('second.png');
  await flush();
  expect(vi.mocked(encodeWebp).mock.calls[0]![2].aborted).toBe(true);
  left.setRange(left.webpMethod, 2);
  left.setRange(left.webpMethod, 6);
  await vi.advanceTimersByTimeAsync(180);
  expect(vi.mocked(encodeWebp).mock.calls[1]![2].aborted).toBe(true);
  expect(encodeWebp).toHaveBeenCalledTimes(3);
  expect(vi.mocked(encodeWebp).mock.lastCall?.[1].method).toBe(6);
  const preview = left.preview.src;
  const replaced = new Blob(['old'], { type: 'image/webp' });
  oldInput.resolve(replaced);
  oldSettings.resolve(replaced);
  await flush();
  expect(left.preview.src).toBe(preview);
  expect(createUrl.mock.calls.some(([blob]) => blob === replaced)).toBe(false);
});

it('MozJPEG debounces independent settings and restores the baseline Huffman choice', async () => {
  const { choose, left, right } = setup();
  left.select('mozjpeg');
  right.select('mozjpeg');
  choose();
  await flush();
  expect(encodeMozjpeg).toHaveBeenCalledOnce();
  expect(left.mozjpegOptimize.checked).toBe(true);
  expect(left.mozjpegOptimize.disabled).toBe(true);
  left.mozjpegProgressive.click();
  left.mozjpegOptimize.click();
  left.mozjpegSubsample.value = '422';
  left.mozjpegSubsample.dispatchEvent(new Event('change'));
  left.setRange(left.mozjpegQuality, 100);
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeMozjpeg).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(encodeMozjpeg).toHaveBeenCalledTimes(2);
  expect(vi.mocked(encodeMozjpeg).mock.lastCall?.[1]).toEqual({
    quality: 100, subsample: '422', progressive: false, optimizeCoding: false,
  });
  left.mozjpegProgressive.click();
  expect(left.mozjpegOptimize.checked).toBe(true);
  expect(left.mozjpegOptimize.disabled).toBe(true);
  left.select('image/jpeg');
  left.select('mozjpeg');
  left.mozjpegProgressive.click();
  expect(left.mozjpegOptimize.checked).toBe(false);
  expect(left.mozjpegOptimize.disabled).toBe(false);
  expect(left.mozjpegQuality.value).toBe('100');
  expect(left.mozjpegSubsample.value).toBe('422');
  expect(right.mozjpegQuality.value).toBe('75');
  expect(right.mozjpegSubsample.value).toBe('420');
  expect(right.mozjpegOptimize.disabled).toBe(true);
});

it('MozJPEG shares pending jobs and completed Blobs and cancels at last detach', async () => {
  const { choose, left, right, createUrl, unmount } = setup();
  const pending = deferred<Blob>();
  vi.mocked(encodeMozjpeg).mockImplementationOnce(() => pending.promise);
  left.select('mozjpeg');
  right.select('mozjpeg');
  left.mozjpegProgressive.click();
  left.mozjpegOptimize.click();
  left.mozjpegProgressive.click();
  choose();
  await flush();
  expect(encodeMozjpeg).toHaveBeenCalledOnce();
  const signal = vi.mocked(encodeMozjpeg).mock.lastCall![2];
  left.mozjpegCancel.click();
  expect(signal.aborted).toBe(false);
  pending.resolve(jpeg);
  await flush();
  expect(right.save.disabled).toBe(false);
  expect(left.save.disabled).toBe(true);
  left.mozjpegRetry.click();
  await flush();
  expect(encodeMozjpeg).toHaveBeenCalledOnce();
  expect(createUrl.mock.calls.slice(-2).map(([blob]) => blob)).toEqual([jpeg, jpeg]);

  const replacement = deferred<Blob>();
  vi.mocked(encodeMozjpeg).mockImplementationOnce(() => replacement.promise);
  choose('replacement.png');
  await flush();
  const replacementSignal = vi.mocked(encodeMozjpeg).mock.lastCall![2];
  left.setRange(left.mozjpegQuality, 90);
  expect(replacementSignal.aborted).toBe(false);
  right.mozjpegCancel.click();
  expect(replacementSignal.aborted).toBe(true);
  await vi.advanceTimersByTimeAsync(180);
  const preview = left.preview.src;
  const stale = new Blob(['stale'], { type: 'image/jpeg' });
  replacement.resolve(stale);
  await flush();
  expect(left.preview.src).toBe(preview);
  expect(createUrl.mock.calls.some(([blob]) => blob === stale)).toBe(false);

  const afterDispose = deferred<Blob>();
  vi.mocked(encodeMozjpeg).mockImplementationOnce(() => afterDispose.promise);
  right.select('original');
  choose('third.png');
  await flush();
  const lastSignal = vi.mocked(encodeMozjpeg).mock.lastCall![2];
  unmount();
  expect(lastSignal.aborted).toBe(true);
  afterDispose.resolve(stale);
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === stale)).toBe(false);
});

it('MozJPEG scores a shared quality-100 Blob once and reuses the result after manual evaluation', async () => {
  const { choose, left, right, evaluate, auto, cancel } = setup();
  const { workers } = mockScoring();
  auto.checked = false;
  auto.dispatchEvent(new Event('change'));
  left.select('mozjpeg');
  right.select('mozjpeg');
  left.setRange(left.mozjpegQuality, 100);
  right.setRange(right.mozjpegQuality, 100);
  choose();
  await flush();
  evaluate.click();
  await flush();
  expect(workers[0]!.postMessage.mock.calls[0]![0].images).toEqual([jpeg]);
  cancel.click();
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();

  evaluate.click();
  await flush();
  workers[1]!.reply({ index: 0, score: 81.56 });
  await flush();
  expect(left.score.textContent).toBe('81.6');
  expect(right.score.textContent).toBe('81.6');
  left.select('original');
  left.select('mozjpeg');
  await flush();
  expect(left.score.textContent).toBe('81.6');
  expect(workers).toHaveLength(2);
});

it('MozJPEG clears automatic evaluation after conversion failure and scores a successful retry', async () => {
  const { choose, left, right } = setup();
  const { workers } = mockScoring();
  vi.mocked(encodeMozjpeg).mockRejectedValueOnce(new Error('Wasm HTTP 503'));
  left.select('mozjpeg');
  right.select('original');
  choose();
  await vi.advanceTimersByTimeAsync(800);
  expect(left.mozjpegRetry.hidden).toBe(false);
  expect(left.error.textContent).toContain('503');
  expect(workers).toHaveLength(0);
  left.mozjpegRetry.click();
  await vi.advanceTimersByTimeAsync(800);
  expect(workers[0]!.postMessage.mock.calls[0]![0].images).toEqual([jpeg]);
});

it('JPEG XL keeps each side’s Distance through lossless mode and debounces effective changes', async () => {
  const { choose, left, right, download } = setup();
  choose('sample.png');
  await flush();
  left.select('image/jxl');
  right.select('image/jxl');
  await flush();
  expect(encodeJxl).toHaveBeenCalledOnce();
  expect(right.jxlDistance.valueAsNumber).toBe(1);
  expect(right.jxlDistanceValue.textContent).toBe('1.0');
  left.setRange(left.jxlDistance, 0.5);
  left.jxlLossless.click();
  expect(left.jxlDistance.disabled).toBe(true);
  expect(left.jxlDistance.valueAsNumber).toBe(0);
  expect(left.jxlDistanceValue.textContent).toBe('0');
  left.setRange(left.jxlEffort, 9);
  expect(right.jxlEffort.value).toBe('7');
  expect(right.jxlDistance.valueAsNumber).toBe(1);
  await vi.advanceTimersByTimeAsync(179);
  expect(encodeJxl).toHaveBeenCalledOnce();
  await vi.advanceTimersByTimeAsync(1);
  expect(vi.mocked(encodeJxl).mock.calls[1]![1]).toEqual({ distance: 0.5, effort: 9, lossless: true });
  expect(left.score.textContent).toBe('可逆圧縮（スコア評価対象外）');
  left.save.click();
  right.save.click();
  expect(download.mock.contexts.map(anchor => (anchor as HTMLAnchorElement).download)).toEqual([
    'sample-left-jxl-lossless-e9.jxl', 'sample-right-jxl-d1.0-e7.jxl',
  ]);
  left.jxlLossless.click();
  expect(left.jxlDistance.disabled).toBe(false);
  expect(left.jxlDistance.value).toBe('0.5');
});

it('JPEG XL shares pending jobs and completed Blobs, and rejects stale results after cancellation and replacement', async () => {
  const { choose, left, right, createUrl } = setup();
  const pending = deferred<Blob>();
  const replaced = deferred<Blob>();
  vi.mocked(encodeJxl).mockReturnValueOnce(pending.promise).mockResolvedValueOnce(jxl).mockReturnValueOnce(replaced.promise);
  await flush();
  left.select('image/jxl');
  right.select('image/jxl');
  left.setRange(left.jxlDistance, 0.5);
  left.jxlLossless.click();
  right.jxlLossless.click();
  choose();
  await flush();
  expect(encodeJxl).toHaveBeenCalledOnce();
  const first = vi.mocked(encodeJxl).mock.calls[0]!;
  expect(left.jxlStatus.textContent).toContain('待っています');
  first[3]();
  expect(right.jxlStatus.textContent).toContain('変換しています');
  left.jxlCancel.click();
  expect(first[2].aborted).toBe(false);
  right.jxlCancel.click();
  expect(first[2].aborted).toBe(true);
  expect(left.jxlStatus.textContent).toContain('中止しました');
  const stale = new Blob(['stale'], { type: 'image/jxl' });
  pending.resolve(stale);
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === stale)).toBe(false);

  left.jxlRetry.click();
  await flush();
  expect(left.jxlStatus.textContent).toContain('完了');
  right.jxlRetry.click();
  await flush();
  expect(encodeJxl).toHaveBeenCalledTimes(2);
  expect(createUrl.mock.calls.slice(-2)).toEqual([[jxl], [jxl]]);

  choose('second.png');
  await flush();
  expect(encodeJxl).toHaveBeenCalledTimes(3);
  choose('third.png');
  await flush();
  expect(vi.mocked(encodeJxl).mock.calls[2]![2].aborted).toBe(true);
  replaced.resolve(stale);
  await flush();
  expect(createUrl.mock.calls.some(([blob]) => blob === stale)).toBe(false);
});

it('JPEG XL can retry a failed conversion', async () => {
  const { choose, right } = setup();
  vi.mocked(encodeJxl).mockRejectedValueOnce(new Error('Wasm HTTP 503'));
  choose();
  await flush();
  right.select('image/jxl');
  await flush();
  expect(right.jxlStatus.textContent).toContain('失敗');
  expect(right.error.textContent).toContain('Wasm HTTP 503');
  expect(right.save.disabled).toBe(true);
  right.jxlRetry.click();
  await flush();
  expect(right.jxlStatus.textContent).toContain('完了');
  expect(right.save.disabled).toBe(false);
});

it('JPEG XL disables the output option when the browser cannot decode its preview', async () => {
  const { choose, right } = setup(bitmap(), { input: false, preview: false });
  choose();
  await flush();
  expect(right.format.querySelector<HTMLOptionElement>('[value="image/jxl"]')?.disabled).toBe(true);
  expect(document.querySelector('.image-jxl-compatibility')?.textContent).toContain('入力と出力を利用できません');
  right.select('image/jxl');
  expect(right.format.value).toBe('image/jpeg');
  expect(encodeJxl).not.toHaveBeenCalled();
});

it('JPEG XL evaluates lossy output automatically and keeps downloads when only the scoring decoder is unavailable', async () => {
  const { choose, left, right, auto, evaluate } = setup();
  const { workers } = mockScoring();
  auto.checked = true;
  choose();
  await flush();
  left.select('image/jxl');
  await vi.advanceTimersByTimeAsync(800);
  const first = workers[0]!;
  expect(first.postMessage.mock.calls[0]![0].images).toEqual([jxl, jpeg]);
  first.reply({ index: 0, unsupported: 'image/jxl' });
  first.reply({ index: 1, score: 88.2 });
  await flush();
  expect(left.score.textContent).toContain('JPEG XLの画質評価を利用できません');
  expect(left.save.disabled).toBe(false);
  expect(right.score.textContent).toBe('88.2');
  expect(evaluate.disabled).toBe(true);
});
