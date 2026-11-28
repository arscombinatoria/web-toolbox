import { expect, it } from 'vitest';
import { defaultJp2Options, effectiveJp2Options, jp2Filename, jp2Key, validateJp2Options } from './options';

it('defaults to PSNR 40 dB and accepts only integer targets within each range', () => {
  expect(effectiveJp2Options(defaultJp2Options)).toEqual({ mode: 'psnr', value: 40 });
  expect(validateJp2Options(null)).toEqual(defaultJp2Options);
  expect(validateJp2Options({ mode: 'ratio', psnr: 20, ratio: 100, lossless: true }))
    .toEqual({ mode: 'ratio', psnr: 20, ratio: 100, lossless: true });
  expect(validateJp2Options({ psnr: 60, ratio: 2 }))
    .toEqual({ ...defaultJp2Options, psnr: 60, ratio: 2 });
  for (const [psnr, ratio] of [[19, 1], [61, 101], [40.5, 2.5], [NaN, Infinity], ['40', '10']]) {
    expect(validateJp2Options({ mode: 'quality', psnr, ratio, lossless: 'true' })).toEqual(defaultJp2Options);
  }
});

it('keys and filenames contain only the input generation and active compression setting', () => {
  const psnr = { ...defaultJp2Options, ratio: 3 };
  expect(jp2Key(1, psnr)).toBe(jp2Key(1, defaultJp2Options));
  expect(jp2Key(2, psnr)).not.toBe(jp2Key(1, psnr));
  expect(jp2Filename('sample', 'left', psnr)).toBe('sample-left-openjpeg-psnr40.jp2');
  const ratio = validateJp2Options({ ...defaultJp2Options, mode: 'ratio' });
  expect(jp2Key(1, { ...ratio, psnr: 60 })).toBe(jp2Key(1, ratio));
  expect(jp2Filename('sample', 'right', ratio)).toBe('sample-right-openjpeg-r10.jp2');
  expect(jp2Key(1, { ...ratio, lossless: true })).toBe(jp2Key(1, { ...psnr, lossless: true }));
  expect(jp2Filename('sample', 'right', { ...ratio, lossless: true })).toBe('sample-right-openjpeg-lossless.jp2');
});
