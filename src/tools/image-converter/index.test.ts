import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode } from './encoder';
import { mount } from './index';

vi.mock('./encoder', async importOriginal => ({
  ...await importOriginal<typeof import('./encoder')>(), decode: vi.fn(), encode: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (cause: Error) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

const bitmap = () => ({ width: 2, height: 2, close: vi.fn() }) as unknown as ImageBitmap;
const jpeg = new Blob(['1234'], { type: 'image/jpeg' });
const png = new Blob(['1'], { type: 'image/png' });
let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.resetAllMocks();
  vi.useRealTimers();
});

function setup() {
  vi.useFakeTimers();
  const active = bitmap();
  vi.mocked(decode).mockResolvedValue(active);
  vi.mocked(encode).mockImplementation(async (_, type) => type === 'image/jpeg' ? jpeg : png);
  let urlNumber = 0;
  const createUrl = vi.fn((_blob: Blob) => 'blob:result-' + ++urlNumber);
  const revokeUrl = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: createUrl, revokeObjectURL: revokeUrl });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
  const download = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const unmount = mount(document.body);
  dispose = unmount;
  const input = document.querySelector<HTMLInputElement>('[type=file]')!;
  const choose = (name = 'input.png', target?: HTMLElement) => {
    const files = [new File(['12'], name, { type: 'image/png' })];
    if (target) {
      const event = new Event('drop', { cancelable: true });
      Object.defineProperty(event, 'dataTransfer', { value: { files } });
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
      output: panel.querySelector('.image-result')!,
      error: panel.querySelector('.image-error')!,
      save: panel.querySelector<HTMLButtonElement>('.image-save')!,
      qualityLabel: panel.querySelector<HTMLElement>('.image-quality')!,
      select(value: string) {
        format.value = value;
        format.dispatchEvent(new Event('change'));
      },
      quality(value: string) {
        slider.value = value;
        slider.dispatchEvent(new Event('input'));
      },
    };
  }
  return {
    active, createUrl, revokeUrl, download, choose, drop: get<HTMLElement>('.image-drop'),
    left: side('left'), right: side('right'),
    comparison: get('.image-comparison'), info: get('.image-info'),
    canvas: get<HTMLCanvasElement>('canvas'),
    unmount() { unmount(); dispose = undefined; },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);

it('初期状態は左Original・右JPEG 0.75で、両側の元画像を再エンコードせず保存できる', async () => {
  const { choose, active, left, right, comparison, canvas, createUrl, download } = setup();
  const file = choose('input.alpha.png');
  await flush();
  expect(left.format.value).toBe('original');
  expect(right.format.value).toBe('image/jpeg');
  expect(right.slider.value).toBe('0.75');
  expect(decode).toHaveBeenCalledOnce();
  expect(encode).toHaveBeenCalledExactlyOnceWith(active, 'image/jpeg', 0.75);
  expect(left.output.textContent).toContain('2 B（元ファイル比 0%）');
  expect(right.output.textContent).toContain('4 B（元ファイル比 +100%）');
  expect(comparison.textContent).toContain('右のサイズを左基準で比較） +100%');

  right.select('original');
  expect(left.qualityLabel.hidden).toBe(true);
  expect(right.qualityLabel.hidden).toBe(true);
  expect(canvas.classList.contains('image-original-left')).toBe(true);
  expect(canvas.classList.contains('image-original-right')).toBe(true);
  expect(right.output.textContent).toContain('2 B（元ファイル比 0%）');
  expect(comparison.textContent).toContain('0%');
  expect(encode).toHaveBeenCalledOnce();
  expect(createUrl).toHaveBeenLastCalledWith(file);
  left.save.click();
  right.save.click();
  const anchors = download.mock.contexts as HTMLAnchorElement[];
  expect(anchors.map(anchor => anchor.download)).toEqual([file.name, file.name]);
  expect(anchors.map(anchor => anchor.href)).toEqual(['blob:result-1', 'blob:result-3']);
});

it('品質を独立して保持し、変更した側だけを変換する', async () => {
  const { choose, active, left, right, comparison, download } = setup();
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
  expect(right.output.textContent).toContain('4 B');
  expect(comparison.textContent).toBe('');
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
  const { choose, left, right, comparison, createUrl, revokeUrl } = setup();
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
  expect(left.output.textContent).toContain('1 B（元ファイル比 -50%）');
  expect(right.output.textContent).toBe(left.output.textContent);
  expect(comparison.textContent).toContain('0%');
  const leftUrl = left.preview.src;
  const rightUrl = right.preview.src;
  left.select('original');
  expect(revokeUrl).toHaveBeenCalledWith(leftUrl);
  expect(revokeUrl).not.toHaveBeenCalledWith(rightUrl);
  expect(right.preview.src).toBe(rightUrl);
  expect(comparison.textContent).toContain('-50%');
});

it('左右の設定変更が重なっても古いエンコードとプレビュー結果を破棄する', async () => {
  const { choose, left, right, comparison, createUrl, revokeUrl } = setup();
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
  expect(comparison.textContent).toContain('0%');
});

it('連続入力・ドロップ・ツール破棄で古いデコードと変換を無効化する', async () => {
  const { choose, drop, active, left, right, canvas, info, createUrl, revokeUrl, unmount } = setup();
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

  choose('new.png', drop);
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
  unmount();
  left.select('image/png');
  right.quality('0.56');
  choose('ignored.png', drop);
  pendingOnUnmount.resolve(jpeg);
  await vi.runAllTimersAsync();
  expect(revokeUrl.mock.calls).toEqual([['blob:result-1'], ['blob:result-2']]);
  expect(replacement.close).toHaveBeenCalledOnce();
  expect(canvas.width).toBe(0);
  expect(decode).toHaveBeenCalledTimes(3);
  expect(encode).toHaveBeenCalledTimes(2);
  expect(document.body.childElementCount).toBe(0);
});
