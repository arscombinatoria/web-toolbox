export interface JpegliOptions {
  mode: 'quality' | 'distance';
  quality: number;
  distance: number;
  subsample: '444' | '440' | '422' | '420';
  progressiveLevel: 0 | 1 | 2;
  adaptiveQuantization: boolean;
  optimizeCoding: boolean;
}

export const defaultJpegliOptions: JpegliOptions = {
  mode: 'quality',
  quality: 90,
  distance: 1.0,
  subsample: '444',
  progressiveLevel: 2,
  adaptiveQuantization: true,
  optimizeCoding: true,
};

export function validateJpegliOptions(value: unknown): JpegliOptions {
  if (!value || typeof value !== 'object') return { ...defaultJpegliOptions };
  const { mode, quality, distance, subsample, progressiveLevel, adaptiveQuantization, optimizeCoding } = value as Record<string, unknown>;
  const distanceTenths = typeof distance === 'number' ? distance * 10 : NaN;
  return {
    mode: mode === 'distance' ? mode : defaultJpegliOptions.mode,
    quality: typeof quality === 'number' && Number.isInteger(quality) && quality >= 1 && quality <= 100
      ? quality : defaultJpegliOptions.quality,
    distance: Number.isInteger(distanceTenths) && distanceTenths >= 1 && distanceTenths <= 250
      ? distanceTenths / 10 : defaultJpegliOptions.distance,
    subsample: subsample === '444' || subsample === '440' || subsample === '422' || subsample === '420'
      ? subsample : defaultJpegliOptions.subsample,
    progressiveLevel: progressiveLevel === 0 || progressiveLevel === 1 || progressiveLevel === 2
      ? progressiveLevel : defaultJpegliOptions.progressiveLevel,
    adaptiveQuantization: typeof adaptiveQuantization === 'boolean' ? adaptiveQuantization : defaultJpegliOptions.adaptiveQuantization,
    optimizeCoding: typeof optimizeCoding === 'boolean' ? optimizeCoding : defaultJpegliOptions.optimizeCoding,
  };
}

export function effectiveJpegliOptions(options: JpegliOptions): JpegliOptions {
  return { ...options, optimizeCoding: options.progressiveLevel > 0 || options.optimizeCoding };
}

function settingsSuffix(options: JpegliOptions): string {
  const { mode, quality, distance, subsample, progressiveLevel, adaptiveQuantization, optimizeCoding } = effectiveJpegliOptions(options);
  const target = mode === 'quality' ? `q${quality}` : `d${distance.toFixed(1)}`;
  return `${target}-${subsample}-p${progressiveLevel}-${adaptiveQuantization ? 'aq' : 'noaq'}-${optimizeCoding ? 'opt' : 'noopt'}`;
}

export function jpegliKey(generation: number, options: JpegliOptions): string {
  return `${generation}:jpegli:${settingsSuffix(options)}`;
}

export function jpegliFilename(stem: string, side: string, options: JpegliOptions): string {
  return `${stem}-${side}-jpegli-${settingsSuffix(options)}.jpg`;
}
