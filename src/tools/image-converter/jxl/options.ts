export interface JxlOptions {
  distance: number;
  effort: number;
  lossless: boolean;
}

export const defaultJxlOptions: Readonly<JxlOptions> = {
  distance: 1,
  effort: 7,
  lossless: false,
};

export function validateJxlOptions(options: JxlOptions): JxlOptions {
  const { distance, effort, lossless } = options;
  const tenths = Math.round(distance * 10);
  if (!Number.isFinite(distance) || distance < 0.1 || distance > 15 || distance !== tenths / 10) {
    throw new RangeError('JPEG XLのDistanceは0.1から15.0までの0.1刻みで指定してください。');
  }
  if (!Number.isInteger(effort) || effort < 1 || effort > 10) {
    throw new RangeError('JPEG XLのEffortは1から10までの整数で指定してください。');
  }
  if (typeof lossless !== 'boolean') throw new TypeError('JPEG XLの可逆圧縮の設定が不正です。');
  return { distance, effort, lossless };
}

export function effectiveJxlOptions(options: JxlOptions) {
  const { distance, effort, lossless } = validateJxlOptions(options);
  return { distanceTenths: lossless ? 0 : Math.round(distance * 10), effort, lossless };
}

export function jxlKey(generation: number, options: JxlOptions): string {
  const { distanceTenths, effort, lossless } = effectiveJxlOptions(options);
  return generation + ':' + (lossless ? 'lossless' : distanceTenths) + ':' + effort;
}

export function jxlFilename(stem: string, side: string, options: JxlOptions): string {
  const { distanceTenths, effort, lossless } = effectiveJxlOptions(options);
  const mode = lossless ? 'lossless' : 'd' + (distanceTenths / 10).toFixed(1);
  return stem + '-' + side + '-jxl-' + mode + '-e' + effort + '.jxl';
}
