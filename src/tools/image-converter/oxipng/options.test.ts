import { expect, it } from 'vitest';
import { defaultOxipngOptions, oxipngKey, validateOxipngOptions } from './options';

it('defaults to Oxipng level 2 without interlace or alpha optimization', () => {
  expect(defaultOxipngOptions).toEqual({ level: 2, interlace: false, optimiseAlpha: false });
  expect(validateOxipngOptions(null)).toEqual(defaultOxipngOptions);
});

it.each([0, 7, 2.5, '3', NaN])('replaces invalid level %s with the default', level => {
  expect(validateOxipngOptions({ level, interlace: true, optimiseAlpha: true })).toEqual({ level: 2, interlace: true, optimiseAlpha: true });
});

it('defaults invalid feature flags independently', () => {
  expect(validateOxipngOptions({ level: 4, interlace: 1, optimiseAlpha: null })).toEqual({ level: 4, interlace: false, optimiseAlpha: false });
});

it('validates flags and includes every encoding option and input generation in its key', () => {
  expect(validateOxipngOptions({ level: 6, interlace: false, optimiseAlpha: true })).toEqual({ level: 6, interlace: false, optimiseAlpha: true });
  const base = { level: 2, interlace: false, optimiseAlpha: false };
  const key = oxipngKey(9, base);
  expect(new Set([
    key,
    oxipngKey(10, base),
    oxipngKey(9, { ...base, level: 3 }),
    oxipngKey(9, { ...base, interlace: true }),
    oxipngKey(9, { ...base, optimiseAlpha: true }),
  ]).size).toBe(5);
});
