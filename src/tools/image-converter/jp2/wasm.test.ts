import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { decodeJp2Pixels, encodeJp2Pixels, instantiateOpenJpeg } from './wasm';

const binary = () => readFileSync(new URL('./openjpeg-2.5.4-8314119b-encoder-decoder.wasm', import.meta.url));
const rgba = {
  width: 3,
  height: 2,
  data: Uint8ClampedArray.of(
    255, 0, 0, 0, 0, 255, 0, 47, 0, 0, 255, 128,
    22, 44, 66, 255, 128, 64, 32, 7, 255, 255, 255, 200,
  ),
};
function indexOfAscii(bytes: Uint8Array, value: string): number {
  const wanted = [...value].map((char) => char.charCodeAt(0));
  for (let index = 0; index <= bytes.length - wanted.length; index++) {
    if (wanted.every((part, i) => bytes[index + i] === part)) return index;
  }
  return -1;
}

function jp2CodestreamOffset(bytes: Uint8Array): number {
  const type = indexOfAscii(bytes, 'jp2c');
  if (type < 4) throw new Error('fixture has no codestream box');
  return type + 4;
}

it('round trips RGB and alpha byte-for-byte in lossless mode', async () => {
  const codec = await instantiateOpenJpeg(binary());
  const bytes = encodeJp2Pixels(codec, rgba, { mode: 'lossless' });
  expect(bytes.subarray(4, 8)).toEqual(Uint8Array.of(0x6a, 0x50, 0x20, 0x20));
  expect(decodeJp2Pixels(codec, bytes)).toEqual({ ...rgba, data: rgba.data });
});

it('round trips a 1×1 pixel and omits alpha only when the input is fully opaque', async () => {
  const codec = await instantiateOpenJpeg(binary());
  const onePixel = { width: 1, height: 1, data: Uint8ClampedArray.of(12, 34, 56, 255) };
  const onePixelBytes = encodeJp2Pixels(codec, onePixel, { mode: 'lossless' });
  expect(decodeJp2Pixels(codec, onePixelBytes)).toEqual(onePixel);

  const opaque = { ...rgba, data: Uint8ClampedArray.from(rgba.data, (_, index) => index % 4 === 3 ? 255 : rgba.data[index]!) };
  const opaqueBytes = encodeJp2Pixels(codec, opaque, { mode: 'lossless' });
  expect(indexOfAscii(opaqueBytes, 'cdef')).toBe(-1);
  expect(decodeJp2Pixels(codec, opaqueBytes)).toEqual(opaque);

  const alphaBytes = encodeJp2Pixels(codec, rgba, { mode: 'lossless' });
  const cdefType = indexOfAscii(alphaBytes, 'cdef');
  expect(cdefType).toBeGreaterThan(4);
  const cdefStart = cdefType - 4;
  const count = new DataView(alphaBytes.buffer, alphaBytes.byteOffset, alphaBytes.byteLength).getUint16(cdefStart + 8);
  expect(count).toBe(4);
  const premultiplied = alphaBytes.slice();
  premultiplied[cdefStart + 30] = 0;
  premultiplied[cdefStart + 31] = 2;
  expect(() => decodeJp2Pixels(codec, premultiplied)).toThrow('対応していません');
});

it('encodes PSNR and ratio settings and decodes their pixels', async () => {
  const codec = await instantiateOpenJpeg(binary());
  const psnr = encodeJp2Pixels(codec, rgba, { mode: 'psnr', value: 40 });
  const ratio = encodeJp2Pixels(codec, rgba, { mode: 'ratio', value: 10 });
  expect(psnr).not.toEqual(ratio);
  expect(decodeJp2Pixels(codec, psnr)).toMatchObject({ width: 3, height: 2 });
  expect(decodeJp2Pixels(codec, ratio)).toMatchObject({ width: 3, height: 2 });
});

it('makes higher PSNR larger and more accurate than ratio compression on textured pixels', async () => {
  const codec = await instantiateOpenJpeg(binary());
  let state = 0x12345678;
  const data = new Uint8ClampedArray(64 * 64 * 4);
  for (let i = 0; i < 64 * 64; i++) {
    state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
    data[i * 4] = state & 255;
    data[i * 4 + 1] = (state >>> 8) & 255;
    data[i * 4 + 2] = (state >>> 16) & 255;
    data[i * 4 + 3] = 255;
  }
  const pixels = { width: 64, height: 64, data };
  const highQuality = encodeJp2Pixels(codec, pixels, { mode: 'psnr', value: 50 });
  const highRatio = encodeJp2Pixels(codec, pixels, { mode: 'ratio', value: 10 });
  const highQualityDecoded = decodeJp2Pixels(codec, highQuality).data;
  const highRatioDecoded = decodeJp2Pixels(codec, highRatio).data;
  const mse = (decoded: Uint8ClampedArray) => {
    let sum = 0;
    for (let i = 0; i < data.length; i += 4) {
      for (let c = 0; c < 3; c++) sum += (data[i + c]! - decoded[i + c]!) ** 2;
    }
    return sum / (64 * 64 * 3);
  };
  expect(highQuality.byteLength).toBeGreaterThan(highRatio.byteLength);
  expect(mse(highQualityDecoded)).toBeLessThan(mse(highRatioDecoded));
});

it('decodes an independently encoded raw J2K RGB fixture', async () => {
  const codec = await instantiateOpenJpeg(binary());
  const bytes = readFileSync(new URL('./fixtures/external-rgb.j2k', import.meta.url));
  const decoded = decodeJp2Pixels(codec, bytes);
  expect(decoded.width).toBe(4);
  expect(decoded.height).toBe(2);
  expect(Array.from(decoded.data)).toEqual([
    255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 64, 128, 192, 255,
    17, 34, 51, 255, 0, 0, 0, 255, 255, 255, 255, 255, 13, 117, 201, 255,
  ]);
});

it('decodes externally encoded 16-bit gray, gray-alpha, and subsampled sYCC fixtures', async () => {
  const codec = await instantiateOpenJpeg(binary());
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const gray = decodeJp2Pixels(codec, fixture('external-gray16.jp2'));
  expect(gray.data).toEqual(Uint8ClampedArray.from(Array.from({ length: 16 }, (_, i) => {
    const value = [0, 64, 128, 255][i % 4]!;
    return [value, value, value, 255];
  }).flat()));

  const grayAlpha = decodeJp2Pixels(codec, fixture('external-gray-alpha-cdef.jp2'));
  expect(Array.from(grayAlpha.data)).toEqual(Array.from({ length: 16 }, (_, i) => {
    const value = [0, 64, 128, 255][i % 4]!;
    return [value, value, value, value];
  }).flat());

  const sycc = decodeJp2Pixels(codec, fixture('external-sycc420.jp2'));
  const neutralAndBlue = [128, 128, 128, 255, 128, 128, 128, 255, 158, 126, 61, 255, 158, 126, 61, 255];
  const greenAndRed = [128, 117, 184, 255, 128, 117, 184, 255, 228, 77, 128, 255, 228, 77, 128, 255];
  expect(Array.from(sycc.data)).toEqual([...neutralAndBlue, ...neutralAndBlue, ...greenAndRed, ...greenAndRed]);

  const oddOrigin = decodeJp2Pixels(codec, fixture('external-sycc420-odd-origin.jp2'));
  const padded = [0, 255, 0, 255];
  const neutral = [128, 128, 128, 255];
  const blue = [158, 126, 61, 255];
  const green = [128, 117, 184, 255];
  const red = [228, 77, 128, 255];
  const oddRows = [
    [...padded, ...padded, ...padded, ...padded],
    [...padded, ...neutral, ...neutral, ...blue],
    [...padded, ...neutral, ...neutral, ...blue],
    [...padded, ...green, ...green, ...red],
  ].flat(2);
  expect(Array.from(oddOrigin.data)).toEqual(oddRows);
});

it('normalizes independently encoded low-precision gray, signed gray, and alpha to the full 8-bit range', async () => {
  const codec = await instantiateOpenJpeg(binary());
  const fixture = (name: string) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url));
  const gray1 = decodeJp2Pixels(codec, fixture('external-low-depth-gray1.jp2'));
  expect(Array.from(gray1.data)).toEqual([
    0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    255, 255, 255, 255, 255, 255, 255, 255, 0, 0, 0, 255,
    255, 255, 255, 255, 0, 0, 0, 255,
  ]);

  const expectedGray4 = [0, 68, 136, 255, 255, 136, 68, 0].flatMap((value) => [value, value, value, 255]);
  expect(Array.from(decodeJp2Pixels(codec, fixture('external-low-depth-gray4.jp2')).data)).toEqual(expectedGray4);
  expect(Array.from(decodeJp2Pixels(codec, fixture('external-low-depth-signed-gray4.jp2')).data)).toEqual(expectedGray4);

  const grayAlpha = decodeJp2Pixels(codec, fixture('external-low-depth-gray-alpha1.jp2'));
  expect(Array.from(grayAlpha.data)).toEqual([
    [0, 0, 0, 0], [255, 255, 255, 255], [0, 0, 0, 255], [255, 255, 255, 0],
    [255, 255, 255, 0], [0, 0, 0, 255], [255, 255, 255, 0], [0, 0, 0, 255],
  ].flat());

  const lowDepthSycc = decodeJp2Pixels(codec, fixture('external-low-depth-sycc4.jp2'));
  expect(Array.from(lowDepthSycc.data)).toEqual([
    [136, 136, 136, 255], [136, 136, 136, 255],
    [136, 102, 255, 255], [136, 102, 255, 255],
    [255, 68, 136, 255], [255, 85, 17, 255],
    [51, 170, 136, 255], [51, 204, 17, 255],
  ].flat());

  const mismatchedSycc = fixture('external-low-depth-sycc4.jp2');
  const ihdr = indexOfAscii(mismatchedSycc, 'ihdr');
  const siz = indexOfAscii(mismatchedSycc, '\xff\x51');
  expect(ihdr).toBeGreaterThanOrEqual(0);
  expect(siz).toBeGreaterThanOrEqual(0);
  mismatchedSycc[ihdr + 14] = 255; // JP2 signals component-specific precision.
  mismatchedSycc[siz + 43] = 7; // Give Cb a different precision from Y and Cr.
  expect(() => decodeJp2Pixels(codec, mismatchedSycc)).toThrow('対応していません');
});

it('rejects invalid dimensions, byte lengths, settings, corrupt data, and external size limits', async () => {
  const codec = await instantiateOpenJpeg(binary());
  expect(() => encodeJp2Pixels(codec, { ...rgba, width: 0 }, { mode: 'lossless' })).toThrow(RangeError);
  expect(() => encodeJp2Pixels(codec, { ...rgba, width: 8193, height: 1, data: new Uint8ClampedArray(8193 * 4) },
    { mode: 'lossless' })).toThrow(RangeError);
  expect(() => encodeJp2Pixels(codec, { ...rgba, data: new Uint8ClampedArray(3) }, { mode: 'lossless' }))
    .toThrow(RangeError);
  expect(() => encodeJp2Pixels(codec, rgba, { mode: 'psnr', value: 0 })).toThrow(RangeError);
  expect(() => decodeJp2Pixels(codec, new Uint8Array(8))).toThrow('破損');
  expect(() => decodeJp2Pixels(codec, new Uint8Array(32 * 1024 * 1024 + 1))).toThrow('上限');

  const valid = readFileSync(new URL('./fixtures/external-rgb.j2k', import.meta.url));
  expect(() => decodeJp2Pixels(codec, valid.subarray(0, valid.length - 2))).toThrow('破損');
  const malformed = encodeJp2Pixels(codec, rgba, { mode: 'lossless' });
  malformed[0] = 0xff; malformed[1] = 0xff; malformed[2] = 0xff; malformed[3] = 0xff;
  expect(() => decodeJp2Pixels(codec, malformed)).toThrow('破損');

  const unsupported = encodeJp2Pixels(codec, { ...rgba, data: Uint8ClampedArray.from(rgba.data,
    (_, index) => index % 4 === 3 ? 255 : rgba.data[index]!) }, { mode: 'lossless' });
  const colorType = indexOfAscii(unsupported, 'colr');
  const colorStart = colorType - 4;
  unsupported[colorStart + 11] = 0;
  unsupported[colorStart + 12] = 0;
  unsupported[colorStart + 13] = 0;
  unsupported[colorStart + 14] = 12; // CMYK enum, unsupported by the RGBA transform.
  expect(() => decodeJp2Pixels(codec, unsupported)).toThrow('対応していません');

  const overLimit = encodeJp2Pixels(codec, rgba, { mode: 'lossless' });
  const codestream = jp2CodestreamOffset(overLimit);
  const view = new DataView(overLimit.buffer, overLimit.byteOffset, overLimit.byteLength);
  const marker = indexOfAscii(overLimit, '\xff\x51');
  expect(marker).toBeGreaterThanOrEqual(codestream);
  view.setUint32(marker + 6, 8193, false); // SIZ Xsiz; rejected before decode.
  expect(() => decodeJp2Pixels(codec, overLimit)).toThrow('上限');
});
