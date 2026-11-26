import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { defaultWebpOptions } from './options';
import { isWebp } from './riff';
import { encodeWebpPixels, instantiateWebp } from './wasm';

it('keeps the raw RGBA fixture, including hidden RGB, in the lossless bitstream', async () => {
  const binary = readFileSync(new URL('./libwebp-1.6.0-encoder.wasm', import.meta.url));
  const encoder = await instantiateWebp(binary);
  const data = new Uint8ClampedArray([
    201, 37, 99, 0, 32, 54, 19, 0, 222, 100, 11, 127,
    25, 75, 20, 255, 141, 191, 89, 1, 19, 83, 52, 0,
  ]);
  const image: ImageData = { width: 3, height: 2, data, colorSpace: 'srgb' };
  const result = encodeWebpPixels(encoder, image, { ...defaultWebpOptions, lossless: true });

  // This bitstream was decoded with native libwebp 1.5.0 (WebPDecodeRGBA).
  // The native result matched all 24 bytes above, without a Canvas round trip.
  const expected = 'UklGRlIAAABXRUJQVlA4TEUAAAAvAkAAEC+gpm0jaO36UinYY3MsyQJMVObPsS+UCOoik7ahGmpgsuZ8TnYTTNLU5bHLF0M6jkdmfbvzgkCAMlU4KKL/sT4A';
  expect(Buffer.from(result).toString('base64')).toBe(expected);
  expect(isWebp(result)).toBe(true);
  expect(encoder.memory.buffer).toBeInstanceOf(ArrayBuffer);
});
