import { expect, it } from 'vitest';
import { defaultJpegliOptions, effectiveJpegliOptions, jpegliFilename, jpegliKey, validateJpegliOptions } from './options';

it('defaults invalid settings and accepts both ends of each numeric range', () => {
  expect(validateJpegliOptions(null)).toEqual(defaultJpegliOptions);
  expect(validateJpegliOptions({
    mode: 'unknown', quality: 99.5, distance: 25.1, subsample: '411', progressiveLevel: -1,
    adaptiveQuantization: 1, optimizeCoding: 'yes',
  })).toEqual(defaultJpegliOptions);
  for (const [quality, distance] of [[1, 0.1], [100, 25], [90, 1.5]] as const) {
    const options = { ...defaultJpegliOptions, mode: 'distance', quality, distance };
    expect(validateJpegliOptions(options)).toEqual(options);
  }
  for (const distance of [0, 1.01, Infinity, NaN]) {
    expect(validateJpegliOptions({ distance }).distance).toBe(1);
  }
});

it('keys the selected target and effective settings, including the input generation', () => {
  const saved = { ...defaultJpegliOptions, optimizeCoding: false, distance: 2.1 };
  expect(effectiveJpegliOptions(saved).optimizeCoding).toBe(true);
  expect(saved.optimizeCoding).toBe(false);
  expect(jpegliKey(1, saved)).toBe(jpegliKey(1, defaultJpegliOptions));
  expect(jpegliKey(2, saved)).not.toBe(jpegliKey(1, saved));
  expect(jpegliKey(1, { ...saved, adaptiveQuantization: false })).not.toBe(jpegliKey(1, saved));
  expect(jpegliFilename('sample', 'left', saved)).toBe('sample-left-jpegli-q90-444-p2-aq-opt.jpg');
  const distance = validateJpegliOptions({ ...saved, mode: 'distance', distance: 1.5, subsample: '420', progressiveLevel: 0 });
  expect(jpegliKey(1, { ...distance, quality: 37 })).toBe(jpegliKey(1, distance));
  expect(jpegliKey(1, { ...distance, optimizeCoding: true })).not.toBe(jpegliKey(1, distance));
  expect(jpegliFilename('sample', 'right', distance)).toBe('sample-right-jpegli-d1.5-420-p0-aq-noopt.jpg');
});
