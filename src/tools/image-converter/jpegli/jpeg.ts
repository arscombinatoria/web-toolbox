import { validateJpeg } from '../jpeg';
import type { JpegliOptions } from './options';

// SetDefaultScanScript in upstream lib/jpegli/encode.cc emits scans in band
// order, with one scan per component unless the band is interleaved.
const bands = [
  [[0, 63, 0x00]],
  [[0, 0, 0x00], [1, 63, 0x01], [1, 63, 0x10]],
  [[0, 0, 0x00], [1, 2, 0x00], [3, 63, 0x02], [3, 63, 0x21], [3, 63, 0x10]],
] as const;

export function isJpegli(bytes: Uint8Array, width: number, height: number, options: JpegliOptions): boolean {
  const { subsample, progressiveLevel } = options;
  const sampling = { '444': 0x11, '440': 0x12, '422': 0x21, '420': 0x22 }[subsample];
  const scanBands = bands[progressiveLevel];
  const interleavedFirst = progressiveLevel === 0 || subsample === '444';
  const firstCount = interleavedFirst ? 1 : 3;
  const expectedCount = firstCount + (scanBands.length - 1) * 3;
  return validateJpeg(bytes, width, height, sampling, progressiveLevel === 0 ? 0xc0 : 0xc2, (header, index) => {
    const band = index < firstCount ? scanBands[0] : scanBands[1 + Math.floor((index - firstCount) / 3)];
    if (!band) return false;
    const components = header[0];
    if (index === 0 && interleavedFirst) {
      if (components !== 3 || header[1] !== 1 || header[3] !== 2 || header[5] !== 3) return false;
    } else {
      const component = (index < firstCount ? index : (index - firstCount) % 3) + 1;
      if (components !== 1 || header[1] !== component) return false;
    }
    const [start, end, approximation] = band;
    return header.at(-3) === start && header.at(-2) === end && header.at(-1) === approximation;
  }, count => count === expectedCount);
}
