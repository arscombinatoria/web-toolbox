import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, it, vi } from 'vitest';
import { defaultJxlOptions } from './options';
import { isJxl } from './signature';
import { encodeJxlPixels, instantiateJxl } from './wasm';

const binary = () => readFileSync(new URL('./libjxl-0.13.0-encoder.wasm', import.meta.url));
const rgba = {
  width: 3, height: 2,
  data: Uint8ClampedArray.of(
    201, 37, 99, 0, 32, 54, 19, 0, 222, 100, 11, 127,
    25, 75, 20, 255, 141, 191, 89, 1, 19, 83, 52, 0,
  ),
};

it('encodes lossy and lossless JPEG XL and releases the output after each call', async () => {
  const encoder = await instantiateJxl(binary());
  const lossy = encodeJxlPixels(encoder, rgba, defaultJxlOptions);
  const lossless = encodeJxlPixels(encoder, rgba, { ...defaultJxlOptions, lossless: true });
  expect(isJxl(lossy)).toBe(true);
  expect(isJxl(lossless)).toBe(true);
  expect(lossy).not.toEqual(lossless);
  expect(encoder.jxl_output()).toBe(0);
  expect(encoder.jxl_output_size()).toBe(0);
});

it('keeps hidden RGB in lossless mode and exact alpha at the highest lossy distance', async () => {
  const encoder = await instantiateJxl(binary());
  const data = Uint8ClampedArray.of(255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 0, 32, 64, 128, 128);
  const pixels = { width: 2, height: 2, data };
  const lossless = encodeJxlPixels(encoder, pixels, { ...defaultJxlOptions, lossless: true, effort: 1 });
  const lossy = encodeJxlPixels(encoder, pixels, { distance: 15, effort: 10, lossless: false });

  // Native libjxl decoded the lossless bitstream to all 16 original bytes and the lossy one to exact alpha.
  expect(createHash('sha256').update(lossless).digest('hex')).toBe('25f92ea920ae13a8380eddd8232a66e9b4db75b6c3f032ce0fb8fc39b4e5cef1');
  expect(createHash('sha256').update(lossy).digest('hex')).toBe('20631966da8a5d2f9a3df4030036ea68a2d8cc1be263dd924dcdbabb87e33893');
});

it('rejects invalid dimensions and clears a previous output on a C wrapper failure', async () => {
  const encoder = await instantiateJxl(binary());
  expect(() => encodeJxlPixels(encoder, { ...rgba, width: 0 }, defaultJxlOptions)).toThrow('寸法');
  expect(() => encodeJxlPixels(encoder, { ...rgba, data: new Uint8ClampedArray(23) }, defaultJxlOptions)).toThrow('RGBA');

  const input = encoder.malloc(rgba.data.length);
  try {
    new Uint8Array(encoder.memory.buffer, input, rgba.data.length).set(rgba.data);
    expect(encoder.jxl_encode(input, rgba.data.length, 3, 2, 10, 7, 0)).toBe(0);
    expect(encoder.jxl_output_size()).toBeGreaterThan(0);
    expect(encoder.jxl_encode(input, 23, 3, 2, 10, 7, 0)).not.toBe(0);
    expect(encoder.jxl_output()).toBe(0);
    expect(encoder.jxl_output_size()).toBe(0);
  } finally {
    encoder.jxl_free_output();
    encoder.free(input);
  }
});

it('reads from the current memory after growth and copies the output before freeing it', () => {
  const memory = new WebAssembly.Memory({ initial: 1, maximum: 2 });
  const output = 65536;
  const bytes = Uint8Array.of(0xff, 0x0a, 0x12);
  const encoder = {
    memory,
    _initialize: () => {},
    JxlEncoderVersion: () => 13000,
    malloc: () => 128,
    free: vi.fn(),
    jxl_encode: () => {
      memory.grow(1);
      new Uint8Array(memory.buffer, output, bytes.length).set(bytes);
      return 0;
    },
    jxl_output: () => output,
    jxl_output_size: () => bytes.length,
    jxl_free_output: vi.fn(() => new Uint8Array(memory.buffer, output, bytes.length).fill(0)),
  };
  expect(encodeJxlPixels(encoder, rgba, defaultJxlOptions)).toEqual(bytes);
  expect(encoder.jxl_free_output).toHaveBeenCalledOnce();
  expect(encoder.free).toHaveBeenCalledWith(128);
});
