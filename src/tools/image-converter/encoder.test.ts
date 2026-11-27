// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { decode, encode, formatFileSize, inputType, sizeChange } from './encoder';

const image = { width: 2, height: 3, close: vi.fn() } as unknown as ImageBitmap;
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

it('AVIF入力は妥当なISO BMFF ftypのmajor/compatible brandだけを受け付ける', () => {
  const box = (brands: string[], extended = false) => {
    const headerSize = extended ? 16 : 8;
    const compatible = brands.slice(1);
    const size = headerSize + 8 + compatible.length * 4;
    const bytes = new Uint8Array(size);
    const view = new DataView(bytes.buffer);
    if (extended) {
      view.setUint32(0, 1);
      bytes.set(new TextEncoder().encode('ftyp'), 4);
      view.setBigUint64(8, BigInt(size));
    } else {
      view.setUint32(0, size);
      bytes.set(new TextEncoder().encode('ftyp'), 4);
    }
    bytes.set(new TextEncoder().encode(brands[0]!), headerSize);
    view.setUint32(headerSize + 4, 0);
    compatible.forEach((brand, index) => bytes.set(new TextEncoder().encode(brand), headerSize + 8 + index * 4));
    return bytes;
  };
  expect(inputType(box(['avif']))).toBe('image/avif');
  expect(inputType(box(['mif1', 'avif']))).toBe('image/avif');
  expect(inputType(box(['avis', 'mif1'], true))).toBe('image/avif');
  expect(inputType(box(['mif1', 'heic']))).toBeUndefined();
  const malformed = box(['mif1', 'avif']);
  new DataView(malformed.buffer).setUint32(0, malformed.byteLength + 1);
  expect(inputType(malformed, malformed.byteLength)).toBeUndefined();
  const badBrandList = box(['mif1', 'avif']);
  new DataView(badBrandList.buffer).setUint32(0, badBrandList.byteLength - 1);
  expect(inputType(badBrandList)).toBeUndefined();
});

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

it.each([
  [0, '0 B'],
  [999, '999 B'],
  [1_000, '1 KB'],
  [999_999, '1,000 KB'],
  [1_000_000, '1 MB'],
  [1_234, '1.23 KB'],
  [1_239, '1.24 KB'],
  [1_234_567, '1.23 MB'],
  [12_345_678, '12.35 MB'],
] as const)('ファイルサイズ %i B を %s と表示する', (bytes, formatted) => {
  expect(formatFileSize(bytes)).toBe(formatted);
});

it('JPEG XLのraw codestreamとcontainerを判定し、短いシグネチャとMIME不整合を拒否する', async () => {
  const raw = Uint8Array.of(0xff, 0x0a);
  const container = Uint8Array.of(0, 0, 0, 0x0c, 0x4a, 0x58, 0x4c, 0x20, 0x0d, 0x0a, 0x87, 0x0a);
  expect(inputType(raw)).toBe('image/jxl');
  expect(inputType(container)).toBe('image/jxl');
  expect(inputType(raw.subarray(0, 1))).toBeUndefined();
  expect(inputType(container.subarray(0, 11))).toBeUndefined();
  expect(inputType(Uint8Array.of(0xff, 0x0b))).toBeUndefined();
  const signal = new AbortController().signal;
  const unsupported = Promise.resolve({ input: false, preview: false });
  await expect(decode(new File([raw], 'fake.png', { type: 'image/png' }), signal, unsupported)).rejects.toThrow('画像を選択');
  await expect(decode(new File(['fake'], 'fake.jxl', { type: 'image/jxl' }), signal, unsupported)).rejects.toThrow('画像を選択');
  await expect(decode(new File([container], 'file.jxl'), signal, unsupported)).rejects.toThrow('JPEG XLの入力を利用できません');
});
