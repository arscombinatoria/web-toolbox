import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode } from './encoder';
import { mount } from './index';

vi.mock('./encoder', async importOriginal => ({
  ...await importOriginal<typeof import('./encoder')>(), decode: vi.fn(), encode: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(res => { resolve = res; });
  return { promise, resolve };
}
const bitmap = () => ({ width: 2, height: 2, close: vi.fn() }) as unknown as ImageBitmap;
const blob = new Blob(['1234'], { type: 'image/png' });
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetAllMocks(); vi.useRealTimers(); });

it('連続入力・形式変更の古い結果を無効化し、破棄時にURLと画像を解放する', async () => {
  vi.useFakeTimers();
  const staleDecode = deferred<ImageBitmap>();
  const staleEncode = deferred<Blob>();
  const old = bitmap();
  const active = bitmap();
  vi.mocked(decode).mockReturnValueOnce(staleDecode.promise).mockResolvedValueOnce(active);
  vi.mocked(encode).mockReturnValueOnce(staleEncode.promise).mockResolvedValue(blob);
  vi.stubGlobal('URL', { createObjectURL: vi.fn(() => 'blob:result'), revokeObjectURL: vi.fn() });
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage() {} } as unknown as CanvasRenderingContext2D);
  Object.defineProperty(HTMLImageElement.prototype, 'decode', { configurable: true, value: () => Promise.resolve() });
  const dispose = mount(document.body);
  const input = document.querySelector<HTMLInputElement>('[type=file]')!;
  const choose = (name: string) => {
    Object.defineProperty(input, 'files', { configurable: true, value: [new File(['12'], name)] });
    input.dispatchEvent(new Event('change'));
  };
  choose('old.jpg'); choose('new.png');
  await vi.advanceTimersByTimeAsync(1);
  staleDecode.resolve(old);
  await Promise.resolve();
  expect(old.close).toHaveBeenCalledOnce();
  expect(document.querySelector('.image-info')!.textContent).toContain('new.png');
  const format = document.querySelector('select')!;
  format.value = 'image/png';
  format.dispatchEvent(new Event('change'));
  const save = document.querySelector<HTMLButtonElement>('.image-save')!;
  expect(save.disabled).toBe(true);
  expect(document.querySelector<HTMLElement>('.image-quality')!.hidden).toBe(true);
  await vi.advanceTimersByTimeAsync(1);
  expect(save.disabled).toBe(false);
  expect(document.querySelector('.image-result')!.textContent).toContain('4 B（+100%）');
  staleEncode.resolve(blob);
  await Promise.resolve();
  expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  format.value = 'image/jpeg';
  format.dispatchEvent(new Event('change'));
  expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:result');
  dispose();
  await vi.runAllTimersAsync();
  expect(encode).toHaveBeenCalledTimes(2);
  expect(active.close).toHaveBeenCalledOnce();
  expect(document.body.childElementCount).toBe(0);
});
