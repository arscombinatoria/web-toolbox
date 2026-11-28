// @vitest-environment jsdom
import { expect, it, vi } from 'vitest';
import { decode, inputType } from '../encoder';
import { decodeJp2 } from './client';
import { jp2FileTypeEnd, jp2InputType } from './signature';

vi.mock('./client', () => ({ decodeJp2: vi.fn() }));

const jp2 = Uint8Array.of(
  0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 13, 10, 0x87, 10,
  0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6a, 0x70, 0x32, 0x20,
  0, 0, 0, 0, 0x6a, 0x70, 0x32, 0x20,
);
const j2k = Uint8Array.of(0xff, 0x4f, 0xff, 0x51);
const fileTypeExtended = Uint8Array.of(
  ...jp2.subarray(0, 12), 0, 0, 0, 1, ...jp2.subarray(16, 20),
  0, 0, 0, 0, 0, 0, 0, 28, ...jp2.subarray(20),
);

it('recognizes Part 1 boxes and codestream markers and rejects inconsistent brands and lengths', () => {
  expect(inputType(jp2)).toBe('image/jp2');
  expect(inputType(j2k)).toBe('image/j2k');
  expect(jp2InputType(fileTypeExtended)).toBe('image/jp2');
  expect(jp2FileTypeEnd(fileTypeExtended.subarray(0, 32), 40)).toBe(40);
  expect(inputType(fileTypeExtended, 39)).toBeUndefined();
  for (const prefix of [jp2.subarray(0, 31), j2k.subarray(0, 3), Uint8Array.of(0xff, 0x4f, 0xff, 0x90)]) {
    expect(inputType(prefix)).toBeUndefined();
  }
  for (const [index, value] of [[11, 0], [15, 19], [18, 0], [22, 0x78], [30, 0x78]] as const) {
    const damaged = jp2.slice();
    damaged[index] = value;
    expect(inputType(damaged)).toBeUndefined();
  }
});

it('routes matching JP2/J2K input to Wasm even without native JPEG XL support', async () => {
  const signal = new AbortController().signal;
  const support = Promise.resolve({ input: false, preview: false });
  vi.mocked(decodeJp2).mockClear();
  for (const file of [
    new File([jp2], 'no-extension', { type: 'image/jp2' }),
    new File([j2k], 'stream.j2c', { type: 'image/x-j2c' }),
    new File([fileTypeExtended], 'extended.jp2', { type: 'application/octet-stream' }),
    new File([j2k], 'stream.j2k'),
  ]) {
    await decode(file, signal, support);
    expect(decodeJp2).toHaveBeenLastCalledWith(file, signal);
  }
  for (const file of [
    new File([j2k], 'wrong.jp2', { type: 'image/jp2' }),
    new File([jp2], 'wrong.j2k', { type: 'image/j2k' }),
    new File([jp2], 'wrong.png', { type: 'image/png' }),
    new File(['data'], 'fake.jp2', { type: 'image/jp2' }),
    new File([Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)], 'wrong.png', { type: 'application/octet-stream' }),
  ]) {
    await expect(decode(file, signal, support)).rejects.toThrow('画像を選択');
  }
  expect(decodeJp2).toHaveBeenCalledTimes(4);
});
