export interface AvifOptions {
  quality: number;
  qualityAlpha: number;
  speed: number;
  subsample: 1 | 2 | 3;
  lossless: boolean;
}

export const defaultAvifOptions: AvifOptions = {
  quality: 50,
  qualityAlpha: 100,
  speed: 6,
  subsample: 1,
  lossless: false,
};

export function validateAvifOptions(value: unknown): AvifOptions {
  if (!value || typeof value !== 'object') return { ...defaultAvifOptions };
  const candidate = value as Record<string, unknown>;
  const integer = (key: string, min: number, max: number, fallback: number) => {
    const item = candidate[key];
    return typeof item === 'number' && Number.isInteger(item) && item >= min && item <= max ? item : fallback;
  };
  const subsample = candidate.subsample;
  return {
    quality: integer('quality', 0, 100, defaultAvifOptions.quality),
    qualityAlpha: integer('qualityAlpha', 0, 100, defaultAvifOptions.qualityAlpha),
    speed: integer('speed', 0, 10, defaultAvifOptions.speed),
    subsample: subsample === 1 || subsample === 2 || subsample === 3 ? subsample : defaultAvifOptions.subsample,
    lossless: typeof candidate.lossless === 'boolean' ? candidate.lossless : defaultAvifOptions.lossless,
  };
}

export function effectiveAvifOptions(options: AvifOptions): Omit<AvifOptions, 'lossless'> {
  return options.lossless
    ? { quality: 100, qualityAlpha: 100, speed: options.speed, subsample: 3 }
    : { quality: options.quality, qualityAlpha: options.qualityAlpha, speed: options.speed, subsample: options.subsample };
}

/** The encoder also selects AV1 identity mode when all three lossless inputs match. */
export function isAvifLossless(options: AvifOptions): boolean {
  const effective = effectiveAvifOptions(options);
  return effective.quality === 100 && effective.qualityAlpha === 100 && effective.subsample === 3;
}

export function avifKey(generation: number, options: AvifOptions): string {
  const effective = effectiveAvifOptions(options);
  return [generation, 'avif', effective.quality, effective.qualityAlpha, effective.speed, effective.subsample].join(':');
}

export function avifFilename(stem: string, side: string, options: AvifOptions): string {
  const effective = effectiveAvifOptions(options);
  return isAvifLossless(options)
    ? `${stem}-${side}-avif-lossless-s${effective.speed}.avif`
    : `${stem}-${side}-avif-q${effective.quality}-a${effective.qualityAlpha}-s${effective.speed}-${['', '420', '422', '444'][effective.subsample]}.avif`;
}
