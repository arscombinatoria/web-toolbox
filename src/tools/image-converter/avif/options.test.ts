import { describe, expect, it } from 'vitest';
import { avifFilename, avifKey, defaultAvifOptions, effectiveAvifOptions, isAvifLossless, validateAvifOptions } from './options';

describe('AVIF options', () => {
  it('uses the requested defaults and validates integer boundaries', () => {
    expect(defaultAvifOptions).toEqual({ quality: 50, qualityAlpha: 100, speed: 6, subsample: 1, lossless: false });
    expect(validateAvifOptions({ quality: 0, qualityAlpha: 0, speed: 0, subsample: 1, lossless: false }))
      .toEqual({ quality: 0, qualityAlpha: 0, speed: 0, subsample: 1, lossless: false });
    expect(validateAvifOptions({ quality: 100, qualityAlpha: 100, speed: 10, subsample: 3, lossless: true }))
      .toEqual({ quality: 100, qualityAlpha: 100, speed: 10, subsample: 3, lossless: true });
  });

  it.each([
    { quality: -1 }, { quality: 101 }, { quality: 50.5 }, { qualityAlpha: -1 }, { qualityAlpha: 101 },
    { speed: -1 }, { speed: 11 }, { speed: 1.5 }, { subsample: 0 }, { subsample: 4 }, { lossless: 1 },
  ])('replaces invalid fields with defaults: %o', invalid => {
    expect(validateAvifOptions(invalid)).toEqual(defaultAvifOptions);
  });

  it('forces explicit lossless settings without changing the remembered lossy values', () => {
    const lossy = { quality: 80, qualityAlpha: 72, speed: 4, subsample: 2 as const, lossless: false };
    expect(effectiveAvifOptions({ ...lossy, lossless: true })).toEqual({ quality: 100, qualityAlpha: 100, speed: 4, subsample: 3 });
    expect(validateAvifOptions({ ...lossy, lossless: true })).toEqual({ ...lossy, lossless: true });
    expect(effectiveAvifOptions(lossy)).toEqual({ quality: 80, qualityAlpha: 72, speed: 4, subsample: 2 });
  });

  it('recognizes effective lossless AV1 settings even when the checkbox is off', () => {
    expect(isAvifLossless({ quality: 100, qualityAlpha: 100, speed: 6, subsample: 3, lossless: false })).toBe(true);
    expect(isAvifLossless(defaultAvifOptions)).toBe(false);
  });

  it('shares work by every effective option and uses stable download names', () => {
    const options = { quality: 50, qualityAlpha: 100, speed: 6, subsample: 1 as const, lossless: false };
    expect(avifKey(2, options)).toBe('2:avif:50:100:6:1');
    expect(avifFilename('sample', 'right', options)).toBe('sample-right-avif-q50-a100-s6-420.avif');
    expect(avifFilename('sample', 'right', { ...options, quality: 80, speed: 4, subsample: 3 }))
      .toBe('sample-right-avif-q80-a100-s4-444.avif');
    expect(avifFilename('sample', 'right', { ...options, quality: 100, subsample: 3 }))
      .toBe('sample-right-avif-lossless-s6.avif');
  });
});
