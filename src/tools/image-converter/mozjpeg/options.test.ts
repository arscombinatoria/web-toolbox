import { expect, it } from 'vitest';
import { isEvaluable } from '../quality/rules';
import { defaultMozjpegOptions, effectiveMozjpegOptions, mozjpegFilename, mozjpegKey, validateMozjpegOptions } from './options';

it.each([1, 75, 100])('accepts quality %i and the supported sampling factors', quality => {
  for (const subsample of ['420', '422', '444'] as const) {
    expect(validateMozjpegOptions({ quality, subsample })).toMatchObject({ quality, subsample });
  }
});

it.each([NaN, Infinity, 0, 101, 75.1, '90', null])('defaults invalid quality and unknown options (%s)', quality => {
  expect(validateMozjpegOptions({ quality, subsample: 420, progressive: 1, optimizeCoding: 'off' }))
    .toEqual(defaultMozjpegOptions);
});

it('forces progressive Huffman optimization without changing the stored baseline preference', () => {
  const saved = { ...defaultMozjpegOptions, quality: 90, subsample: '444' as const, optimizeCoding: false };
  const baseline = { ...saved, progressive: false };
  expect(effectiveMozjpegOptions(saved).optimizeCoding).toBe(true);
  expect(effectiveMozjpegOptions(baseline).optimizeCoding).toBe(false);
  expect(saved.optimizeCoding).toBe(false);
  expect(mozjpegKey(3, saved)).toBe(mozjpegKey(3, { ...saved, optimizeCoding: true }));
  expect(mozjpegKey(3, saved)).not.toBe(mozjpegKey(3, baseline));
  expect(mozjpegKey(3, saved)).not.toBe(mozjpegKey(4, saved));
  expect(mozjpegFilename('sample', 'right', defaultMozjpegOptions)).toBe('sample-right-mozjpeg-q75-420-p-opt.jpg');
  expect(mozjpegFilename('sample', 'right', baseline)).toBe('sample-right-mozjpeg-q90-444-b-noopt.jpg');
  expect(mozjpegFilename('sample', 'right', { ...baseline, optimizeCoding: true })).toBe('sample-right-mozjpeg-q90-444-b-opt.jpg');
  expect(isEvaluable('mozjpeg')).toBe(true);
});
