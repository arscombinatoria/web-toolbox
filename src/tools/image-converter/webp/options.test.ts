import { expect, it } from 'vitest';
import { isEvaluable } from '../quality/rules';
import { defaultWebpOptions, effectiveWebpOptions, validateWebpOptions, webpFilename, webpKey } from './options';

it('accepts inclusive integer boundaries and defaults invalid fields independently', () => {
  expect(validateWebpOptions({ quality: 0, losslessQuality: 100, alphaQuality: 0, method: 6, lossless: true, sharpYuv: true }))
    .toEqual({ quality: 0, losslessQuality: 100, alphaQuality: 0, method: 6, lossless: true, sharpYuv: true });
  expect(validateWebpOptions({ quality: 100, losslessQuality: 0, alphaQuality: 100, method: 0 }))
    .toEqual({ ...defaultWebpOptions, quality: 100, losslessQuality: 0, method: 0 });
  expect(validateWebpOptions({ quality: NaN, losslessQuality: 101, alphaQuality: '100', method: 2.5, lossless: 1, sharpYuv: null }))
    .toEqual(defaultWebpOptions);
  expect(validateWebpOptions({ quality: -1, method: 7 })).toEqual(defaultWebpOptions);
  expect(validateWebpOptions(null)).toEqual(defaultWebpOptions);
});

it('maps lossy quality 100 to lossy and uses independent lossless effort with exact RGBA', () => {
  const options = { ...defaultWebpOptions, quality: 100, losslessQuality: 19, alphaQuality: 36, method: 0, sharpYuv: true };
  expect(effectiveWebpOptions(options)).toEqual({
    lossless: 0, quality: 100, alpha_quality: 36, method: 0, use_sharp_yuv: 1, exact: 0, near_lossless: 100,
  });
  expect(effectiveWebpOptions({ ...options, lossless: true })).toEqual({
    lossless: 1, quality: 19, alpha_quality: 100, method: 0, use_sharp_yuv: 0, exact: 1, near_lossless: 100,
  });
  expect(isEvaluable('image/webp', options.lossless)).toBe(true);
  expect(isEvaluable('image/webp', true)).toBe(false);
});

it('keys and filenames contain only effective settings', () => {
  const options = { ...defaultWebpOptions, lossless: true };
  expect(webpKey(7, options)).toBe(webpKey(7, { ...options, quality: 21, alphaQuality: 0, sharpYuv: true }));
  expect(webpKey(7, options)).not.toBe(webpKey(8, options));
  expect(webpKey(7, options)).not.toBe(webpKey(7, { ...options, lossless: false }));
  expect(webpKey(7, options)).not.toBe(webpKey(7, { ...options, losslessQuality: 70 }));
  expect(webpKey(7, defaultWebpOptions)).toBe(webpKey(7, { ...defaultWebpOptions, losslessQuality: 1 }));
  expect(webpFilename('sample', 'right', defaultWebpOptions)).toBe('sample-right-webp-q75-a100-m4.webp');
  expect(webpFilename('sample', 'right', { ...defaultWebpOptions, sharpYuv: true })).toBe('sample-right-webp-q75-a100-m4-sharp.webp');
  expect(webpFilename('sample', 'right', options)).toBe('sample-right-webp-lossless-q75-m4.webp');
});
