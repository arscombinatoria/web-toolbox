import { expect, it } from 'vitest';
import { defaultJxlOptions, effectiveJxlOptions, jxlFilename, jxlKey, validateJxlOptions } from './options';

it('accepts the distance and effort boundaries with exact integer distance tenths', () => {
  for (const [distance, effort, distanceTenths] of [[0.1, 1, 1], [8.3, 7, 83], [15, 10, 150]] as const) {
    const options = { distance, effort, lossless: false };
    expect(validateJxlOptions(options)).toEqual(options);
    expect(effectiveJxlOptions(options)).toEqual({ distanceTenths, effort, lossless: false });
  }
});

it('rejects invalid distances, effort levels and mode values', () => {
  for (const distance of [-1, 0, 0.05, 1.17, 15.1, NaN, Infinity]) {
    expect(() => validateJxlOptions({ ...defaultJxlOptions, distance })).toThrow('Distance');
  }
  for (const effort of [0, 11, 1.1, NaN, Infinity]) {
    expect(() => validateJxlOptions({ ...defaultJxlOptions, effort })).toThrow('Effort');
  }
  expect(() => validateJxlOptions({ ...defaultJxlOptions, lossless: 'false' as unknown as boolean })).toThrow('可逆圧縮');
});

it('uses the effective values for the shared job key and filename', () => {
  const lossy = { distance: 0.5, effort: 9, lossless: false };
  const lossless = { ...defaultJxlOptions, lossless: true };
  expect(effectiveJxlOptions(lossless)).toEqual({ distanceTenths: 0, effort: 7, lossless: true });
  expect(jxlKey(1, lossless)).toBe(jxlKey(1, { ...lossless, distance: 15 }));
  expect(jxlKey(1, lossless)).not.toBe(jxlKey(2, lossless));
  expect(jxlKey(1, lossless)).not.toBe(jxlKey(1, { ...lossless, effort: 8 }));
  expect(jxlKey(1, lossy)).not.toBe(jxlKey(1, { ...lossy, distance: 0.6 }));
  expect(jxlFilename('sample', 'right', defaultJxlOptions)).toBe('sample-right-jxl-d1.0-e7.jxl');
  expect(jxlFilename('sample', 'right', lossy)).toBe('sample-right-jxl-d0.5-e9.jxl');
  expect(jxlFilename('sample', 'right', lossless)).toBe('sample-right-jxl-lossless-e7.jxl');
});
