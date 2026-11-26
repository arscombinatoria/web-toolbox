export interface WebpOptions {
  quality: number;
  losslessQuality: number;
  alphaQuality: number;
  method: number;
  lossless: boolean;
  sharpYuv: boolean;
}

export const defaultWebpOptions: WebpOptions = {
  quality: 75,
  losslessQuality: 75,
  alphaQuality: 100,
  method: 4,
  lossless: false,
  sharpYuv: false,
};

export function validateWebpOptions(value: unknown): WebpOptions {
  if (!value || typeof value !== 'object') return { ...defaultWebpOptions };
  const candidate = value as Record<string, unknown>;
  const integer = (key: 'quality' | 'losslessQuality' | 'alphaQuality' | 'method', max: number) => {
    const item = candidate[key];
    return typeof item === 'number' && Number.isInteger(item) && item >= 0 && item <= max
      ? item
      : defaultWebpOptions[key];
  };
  return {
    quality: integer('quality', 100),
    losslessQuality: integer('losslessQuality', 100),
    alphaQuality: integer('alphaQuality', 100),
    method: integer('method', 6),
    lossless: typeof candidate.lossless === 'boolean' ? candidate.lossless : defaultWebpOptions.lossless,
    sharpYuv: typeof candidate.sharpYuv === 'boolean' ? candidate.sharpYuv : defaultWebpOptions.sharpYuv,
  };
}

export function effectiveWebpOptions(options: WebpOptions) {
  return {
    lossless: options.lossless ? 1 : 0,
    quality: options.lossless ? options.losslessQuality : options.quality,
    alpha_quality: options.lossless ? 100 : options.alphaQuality,
    method: options.method,
    use_sharp_yuv: !options.lossless && options.sharpYuv ? 1 : 0,
    exact: options.lossless ? 1 : 0,
    near_lossless: 100,
  };
}

export function webpKey(generation: number, options: WebpOptions): string {
  const effective = effectiveWebpOptions(options);
  return [generation, 'webp', effective.lossless, effective.quality, effective.alpha_quality, effective.method, effective.use_sharp_yuv].join(':');
}

export function webpFilename(stem: string, side: string, options: WebpOptions): string {
  const effective = effectiveWebpOptions(options);
  if (effective.lossless) return `${stem}-${side}-webp-lossless-q${effective.quality}-m${effective.method}.webp`;
  const sharp = effective.use_sharp_yuv ? '-sharp' : '';
  return `${stem}-${side}-webp-q${effective.quality}-a${effective.alpha_quality}-m${effective.method}${sharp}.webp`;
}
