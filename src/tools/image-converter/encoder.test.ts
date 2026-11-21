import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode, sizeChange } from './encoder';

const image = { width: 2, height: 3, close: vi.fn() } as unknown as ImageBitmap;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it.each(['image/jpeg', 'image/png'] as const)('%s の画布と品質、出力形式を検証する', async type => {
  const ctx = { fillStyle: '', drawImage: vi.fn(), fillRect: vi.fn() };
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx as unknown as CanvasRenderingContext2D);
  const exportBlob = vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(cb => cb(new Blob(['data'], { type })));
  expect((await encode(image, type, 0.32)).type).toBe(type);
  expect(exportBlob).toHaveBeenCalledWith(expect.any(Function), type, type === 'image/jpeg' ? 0.32 : undefined);
  expect(ctx.drawImage).toHaveBeenCalledWith(image, 0, 0);
  if (type === 'image/jpeg') {
    expect(ctx.fillStyle).toBe('#fff');
    expect(ctx.fillRect).toHaveBeenCalledWith(0, 0, 2, 3);
    expect(ctx.fillRect.mock.invocationCallOrder[0]!).toBeLessThan(ctx.drawImage.mock.invocationCallOrder[0]!);
  } else expect(ctx.fillRect).not.toHaveBeenCalled();
  exportBlob.mockImplementation(cb => cb(new Blob(['wrong'], { type: 'text/plain' })));
  await expect(encode(image, type, 0.75)).rejects.toThrow('変換');
});

it('形式の偽装、デコード失敗、画素数超過を処理する', async () => {
  const signal = new AbortController().signal;
  let width = 2;
  vi.stubGlobal('Image', class {
    get naturalWidth() { return width; }
    get naturalHeight() { return width; }
    onload?: () => void;
    set src(_url: string) { queueMicrotask(() => this.onload?.()); }
    removeAttribute() {}
  });
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:input', revokeObjectURL: vi.fn() });
  const read = vi.fn();
  vi.stubGlobal('createImageBitmap', read);
  const png = new File([new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])], 'demo.png', { type: 'image/png' });
  await expect(decode(new File(['<svg/>'], 'fake.png', { type: 'image/png' }), signal)).rejects.toThrow('JPEG・PNG・WebP');
  expect(read).not.toHaveBeenCalled();
  read.mockRejectedValueOnce(new Error());
  await expect(decode(png, signal)).rejects.toThrow('破損');
  width = 5000;
  await expect(decode(png, signal)).rejects.toThrow('画素');
  expect(read).toHaveBeenCalledOnce();
  expect(URL.revokeObjectURL).toHaveBeenCalledTimes(2);
});

it('増加・減少・同サイズ・空入力の増減率', () => {
  expect([150, 50, 100].map(n => sizeChange(100, n))).toEqual(['+50%', '-50%', '0%']);
  expect(sizeChange(0, 5)).toBe('—');
});
