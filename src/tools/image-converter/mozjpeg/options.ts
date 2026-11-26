export interface MozjpegOptions {
  quality: number;
  subsample: '420' | '422' | '444';
  progressive: boolean;
  optimizeCoding: boolean;
}

export const defaultMozjpegOptions: MozjpegOptions = {
  quality: 75,
  subsample: '420',
  progressive: true,
  optimizeCoding: true,
};

export function validateMozjpegOptions(value: unknown): MozjpegOptions {
  if (!value || typeof value !== 'object') return { ...defaultMozjpegOptions };
  const { quality, subsample, progressive, optimizeCoding } = value as Record<string, unknown>;
  return {
    quality: typeof quality === 'number' && Number.isInteger(quality) && quality >= 1 && quality <= 100
      ? quality : defaultMozjpegOptions.quality,
    subsample: subsample === '420' || subsample === '422' || subsample === '444'
      ? subsample : defaultMozjpegOptions.subsample,
    progressive: typeof progressive === 'boolean' ? progressive : defaultMozjpegOptions.progressive,
    optimizeCoding: typeof optimizeCoding === 'boolean' ? optimizeCoding : defaultMozjpegOptions.optimizeCoding,
  };
}

export function effectiveMozjpegOptions(options: MozjpegOptions): MozjpegOptions {
  return { ...options, optimizeCoding: options.progressive || options.optimizeCoding };
}

function settingsSuffix(options: MozjpegOptions): string {
  const { quality, subsample, progressive, optimizeCoding } = effectiveMozjpegOptions(options);
  return `q${quality}-${subsample}-${progressive ? 'p' : 'b'}-${optimizeCoding ? 'opt' : 'noopt'}`;
}

export function mozjpegKey(generation: number, options: MozjpegOptions): string {
  return `${generation}:mozjpeg:${settingsSuffix(options)}`;
}

export function mozjpegFilename(stem: string, side: string, options: MozjpegOptions): string {
  return `${stem}-${side}-mozjpeg-${settingsSuffix(options)}.jpg`;
}
