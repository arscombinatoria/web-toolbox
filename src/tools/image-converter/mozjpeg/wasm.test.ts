import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { isMozjpeg } from './jpeg';
import { defaultMozjpegOptions } from './options';
import { encodeMozjpegPixels, instantiateMozjpeg, validMozjpegDimensions } from './wasm';

let encoder: Awaited<ReturnType<typeof instantiateMozjpeg>>;
beforeAll(async () => {
  const binary = readFileSync(new URL('./mozjpeg-4.1.5-encoder.wasm', import.meta.url));
  encoder = await instantiateMozjpeg(binary);
});

function fixture(width: number, height: number) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const x = i / 4 % width;
    const y = Math.floor(i / 4 / width);
    data[i] = (x * 29 + y * 3) & 255;
    data[i + 1] = (x * 7 + y * 31) & 255;
    data[i + 2] = (x * 11 + y * 17) & 255;
    data[i + 3] = 255;
  }
  return { width, height, data };
}

it.each(['420', '422', '444'] as const)('encodes an odd-sized frame with sampling %s in all modes', subsample => {
  const pixels = fixture(35, 19);
  const base = { ...defaultMozjpegOptions, subsample };
  const baseline = { ...base, progressive: false, optimizeCoding: false };
  const optimized = { ...baseline, optimizeCoding: true };
  const progressive = { ...base, optimizeCoding: false };
  const outputs = [baseline, optimized, progressive].map(options => {
    const bytes = encodeMozjpegPixels(encoder, pixels, options);
    expect(Array.from(bytes.subarray(0, 2))).toEqual([0xff, 0xd8]);
    expect(Array.from(bytes.subarray(-2))).toEqual([0xff, 0xd9]);
    expect(isMozjpeg(bytes, pixels.width, pixels.height, options)).toBe(true);
    expect(isMozjpeg(bytes.subarray(0, -1), pixels.width, pixels.height, options)).toBe(false);
    const frame = Buffer.from(bytes).indexOf(Buffer.from([0xff, options.progressive ? 0xc2 : 0xc0]));
    expect(frame).toBeGreaterThan(1);
    expect(bytes[frame + 11]).toBe({ '420': 0x22, '422': 0x21, '444': 0x11 }[subsample]);
    return Buffer.from(bytes);
  });
  const firstHuffmanTable = (bytes: Buffer) => {
    const offset = bytes.indexOf(Buffer.from([0xff, 0xc4]));
    expect(offset).toBeGreaterThan(1);
    const start = offset + 4;
    const symbols = bytes.subarray(start + 1, start + 17).reduce((sum, count) => sum + count, 0);
    return bytes.subarray(start, start + 17 + symbols);
  };
  // Annex K's default luminance DC table (table ID, code counts, values).
  expect(firstHuffmanTable(outputs[0]!)).toEqual(Buffer.from([
    0, 0, 1, 5, 1, 1, 1, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0,
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
  ]));
  expect(firstHuffmanTable(outputs[0]!)).not.toEqual(firstHuffmanTable(outputs[1]!));
  expect(encodeMozjpegPixels(encoder, pixels, base)).toEqual(encodeMozjpegPixels(encoder, pixels, progressive));
});

it.each([[1, 1, 1], [8192, 1, 100], [1, 8192, 100]])('encodes %i × %i at quality %i', (width, height, quality) => {
  const options = { ...defaultMozjpegOptions, quality };
  expect(isMozjpeg(encodeMozjpegPixels(encoder, fixture(width, height), options), width, height, options)).toBe(true);
});

it('rejects dimensions, pixel buffers and native settings outside the contract and can encode again', () => {
  for (const [width, height] of [[0, 1], [-1, 2], [1.5, 1], [8193, 1], [4000, 4001], [NaN, 10]] as const) {
    expect(validMozjpegDimensions(width, height)).toBe(false);
    expect(() => encodeMozjpegPixels(encoder, { width, height, data: new Uint8ClampedArray() }, defaultMozjpegOptions))
      .toThrow(RangeError);
  }
  expect(validMozjpegDimensions(4000, 4000)).toBe(true);
  expect(() => encodeMozjpegPixels(encoder, { ...fixture(1, 1), width: 2 }, defaultMozjpegOptions)).toThrow(RangeError);
  expect(() => encodeMozjpegPixels(encoder, fixture(1, 1), { ...defaultMozjpegOptions, quality: 101 })).toThrow('MozJPEG');
  expect(isMozjpeg(encodeMozjpegPixels(encoder, fixture(1, 1), defaultMozjpegOptions), 1, 1, defaultMozjpegOptions)).toBe(true);
});

it('checks current memory after growth and rejects invalid returned output bounds', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const frees: number[] = [];
  const fake = {
    ...encoder,
    memory,
    malloc: (length: number) => length === 8 ? 32 : 16,
    free: (address: number) => { frees.push(address); },
    mozjpeg_encode: () => {
      memory.grow(1);
      const result = new DataView(memory.buffer, 32, 8);
      result.setUint32(0, memory.buffer.byteLength - 1, true);
      result.setUint32(4, 2, true);
      return 0;
    },
  };
  expect(() => encodeMozjpegPixels(fake, fixture(1, 1), defaultMozjpegOptions)).toThrow('メモリ範囲');
  expect(frees).toEqual([32, 16]);
});

it('enforces the 1 GiB limit without shared memory', () => {
  const pageSize = 65_536;
  expect(encoder.memory.buffer).toBeInstanceOf(ArrayBuffer);
  const pagesOverLimit = (1_073_741_824 - encoder.memory.buffer.byteLength) / pageSize + 1;
  expect(() => encoder.memory.grow(pagesOverLimit)).toThrow(RangeError);
});
