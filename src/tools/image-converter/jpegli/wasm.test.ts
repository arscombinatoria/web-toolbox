import { readFileSync } from 'node:fs';
import { beforeAll, expect, it } from 'vitest';
import { isJpegli } from './jpeg';
import { defaultJpegliOptions, type JpegliOptions } from './options';
import { encodeJpegliPixels, instantiateJpegli, validJpegliDimensions } from './wasm';

let encoder: Awaited<ReturnType<typeof instantiateJpegli>>;
beforeAll(async () => {
  const binary = readFileSync(new URL('./jpegli-c7d342c25d3587ac0110c915989ad94f414b6c8d-encoder.wasm', import.meta.url));
  encoder = await instantiateJpegli(binary);
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

it.each(['444', '440', '422', '420'] as const)('encodes odd dimensions with sampling %s at all progressive levels', subsample => {
  const { width, height } = fixture(35, 19);
  for (const progressiveLevel of [0, 1, 2] as const) {
    const options = { ...defaultJpegliOptions, subsample, progressiveLevel };
    const bytes = encodeJpegliPixels(encoder, fixture(width, height), options);
    expect(isJpegli(bytes, width, height, options)).toBe(true);
    expect(isJpegli(bytes, width - 1, height, options)).toBe(false);
    expect(isJpegli(bytes.subarray(0, -1), width, height, options)).toBe(false);
    expect(isJpegli(bytes, width, height, { ...options, progressiveLevel: progressiveLevel === 2 ? 1 : 2 })).toBe(false);
    const corrupted = bytes.slice();
    const scan = Buffer.from(bytes).indexOf(Buffer.from([0xff, 0xda]));
    expect(scan).toBeGreaterThan(0);
    corrupted[scan + 5] = 4;
    expect(isJpegli(corrupted, width, height, options)).toBe(false);
  }
});

it.each([
  [1, 1, { quality: 1 }],
  [8192, 1, { quality: 100, progressiveLevel: 0, optimizeCoding: false }],
  [1, 8192, { mode: 'distance', distance: 0.1 }],
  [35, 19, { mode: 'distance', distance: 25, progressiveLevel: 0 }],
] as const)('encodes dimensions and settings at their bounds (%i × %i, %j)', (width, height, change) => {
  const options: JpegliOptions = { ...defaultJpegliOptions, ...change };
  expect(isJpegli(encodeJpegliPixels(encoder, fixture(width, height), options), width, height, options)).toBe(true);
});

function jpegQuantizationTables(bytes: Uint8Array): Map<number, Uint8Array> {
  const tables = new Map<number, Uint8Array>();
  for (let offset = 2; offset + 4 <= bytes.length;) {
    if (bytes[offset] !== 0xff) break;
    const marker = bytes[offset + 1]!;
    if (marker === 0xda || marker === 0xd9) break;
    const length = bytes[offset + 2]! * 256 + bytes[offset + 3]!;
    const end = offset + 2 + length;
    if (length < 2 || end > bytes.length) break;
    if (marker === 0xdb) {
      for (let cursor = offset + 4; cursor < end;) {
        const descriptor = bytes[cursor++]!;
        const precision = descriptor >> 4;
        const tableId = descriptor & 0x0f;
        const tableLength = precision === 0 ? 64 : 128;
        if (cursor + tableLength > end) break;
        tables.set(tableId, bytes.slice(cursor, cursor + tableLength));
        cursor += tableLength;
      }
    }
    offset = end;
  }
  return tables;
}

it.each([
  ['distance', { mode: 'distance', distance: 1.0 }],
  ['quality', { mode: 'quality', quality: 90 }],
] as const)('creates sampling-specific quantization tables for %s mode', (mode, setting) => {
  const pixels = fixture(97, 69);
  const encode = (subsample: JpegliOptions['subsample']) => {
    const options = { ...defaultJpegliOptions, ...setting, mode, subsample };
    return jpegQuantizationTables(encodeJpegliPixels(encoder, pixels, options));
  };
  const tables444 = encode('444');
  const tables420 = encode('420');
  expect(tables444.get(0)).toBeDefined();
  expect(tables420.get(0)).toBeDefined();
  expect(tables444.get(0)).not.toEqual(tables420.get(0));
  expect(tables444.get(1)).not.toEqual(tables420.get(1));
});

it('uses the stored Huffman choice only for sequential output and applies adaptive quantization', () => {
  const pixels = fixture(97, 69);
  const encode = (change: Partial<JpegliOptions>) =>
    encodeJpegliPixels(encoder, pixels, { ...defaultJpegliOptions, ...change });
  expect(encode({ optimizeCoding: false })).toEqual(encode({ optimizeCoding: true }));
  const sequential = { progressiveLevel: 0 } as const;
  const unoptimized = encode({ ...sequential, optimizeCoding: false });
  expect(isJpegli(unoptimized, pixels.width, pixels.height, { ...defaultJpegliOptions, ...sequential })).toBe(true);
  expect(unoptimized).not.toEqual(encode({ ...sequential, optimizeCoding: true }));
  expect(encode({ adaptiveQuantization: false })).not.toEqual(encode({ adaptiveQuantization: true }));
});

it('rejects invalid dimensions, RGBA lengths, ABI ranges and pointers and can encode again', () => {
  for (const [width, height] of [[0, 1], [-1, 2], [1.5, 1], [8193, 1], [4000, 4001], [NaN, 10]] as const) {
    expect(validJpegliDimensions(width, height)).toBe(false);
    expect(() => encodeJpegliPixels(encoder, { width, height, data: new Uint8ClampedArray() }, defaultJpegliOptions))
      .toThrow(RangeError);
  }
  expect(validJpegliDimensions(4000, 4000)).toBe(true);
  expect(() => encodeJpegliPixels(encoder, { ...fixture(1, 1), width: 2 }, defaultJpegliOptions)).toThrow(RangeError);
  const input = encoder.malloc(4);
  const result = encoder.malloc(8);
  try {
    new Uint8Array(encoder.memory.buffer, input, 4).fill(0xff);
    const valid = [input, 4, 1, 1, 0, 90, 444, 2, 1, 1, result] as const;
    for (const [index, value] of [[0, 0], [0, -1], [1, -1], [1, 3], [2, 8193], [4, 2], [5, 101],
      [6, 411], [7, 3], [8, 2], [9, 0], [10, 0], [10, -1], [10, input]] as const) {
      const fields = [...valid] as Parameters<typeof encoder.jpegli_encode>;
      fields[index] = value;
      expect(encoder.jpegli_encode(...fields)).not.toBe(0);
    }
    expect([...new Uint8Array(encoder.memory.buffer, input, 4)]).toEqual([255, 255, 255, 255]);
    for (const value of [0, 251]) {
      expect(encoder.jpegli_encode(input, 4, 1, 1, 1, value, 444, 0, 1, 1, result)).not.toBe(0);
    }
  } finally {
    encoder.free(result);
    encoder.free(input);
  }
  expect(isJpegli(encodeJpegliPixels(encoder, fixture(1, 1), defaultJpegliOptions), 1, 1, defaultJpegliOptions)).toBe(true);
});

it('uses the current memory after growth and checks returned ranges before freeing', () => {
  const memory = new WebAssembly.Memory({ initial: 1 });
  const frees: number[] = [];
  const fake = {
    ...encoder,
    memory,
    malloc: (length: number) => length === 8 ? 32 : 16,
    free: (address: number) => { frees.push(address); },
    jpegli_encode: () => {
      memory.grow(1);
      const result = new DataView(memory.buffer, 32, 8);
      result.setUint32(0, memory.buffer.byteLength - 1, true);
      result.setUint32(4, 2, true);
      return 0;
    },
  };
  expect(() => encodeJpegliPixels(fake, fixture(1, 1), defaultJpegliOptions)).toThrow('メモリ範囲');
  expect(frees).toEqual([32, 16]);
});

it('caps growth at 1 GiB and uses unshared memory', () => {
  expect(encoder.memory.buffer).toBeInstanceOf(ArrayBuffer);
  const pagesOverLimit = (1_073_741_824 - encoder.memory.buffer.byteLength) / 65_536 + 1;
  expect(() => encoder.memory.grow(pagesOverLimit)).toThrow(RangeError);
});
