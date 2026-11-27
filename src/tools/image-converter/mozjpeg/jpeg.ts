import type { MozjpegOptions } from './options';
import { validateJpeg } from '../jpeg';

export function isMozjpeg(bytes: Uint8Array, width: number, height: number, options: MozjpegOptions): boolean {
  const sampling = { '420': 0x22, '422': 0x21, '444': 0x11 }[options.subsample];
  return validateJpeg(bytes, width, height, sampling, options.progressive ? 0xc2 : 0xc0,
    header => options.progressive || (header[0] === 3 && header[7] === 0 && header[8] === 63 && header[9] === 0),
    count => options.progressive ? count > 1 : count === 1);
}
