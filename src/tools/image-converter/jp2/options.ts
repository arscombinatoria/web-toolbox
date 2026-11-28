export interface Jp2Options {
  mode: 'psnr' | 'ratio';
  psnr: number;
  ratio: number;
  lossless: boolean;
}

export type Jp2Settings = { mode: 'lossless' } | { mode: 'psnr' | 'ratio'; value: number };

export const defaultJp2Options: Readonly<Jp2Options> = {
  mode: 'psnr',
  psnr: 40,
  ratio: 10,
  lossless: false,
};

function integer(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}

export function validateJp2Options(value: unknown): Jp2Options {
  if (!value || typeof value !== 'object') return { ...defaultJp2Options };
  const { mode, psnr, ratio, lossless } = value as Record<string, unknown>;
  return {
    mode: mode === 'ratio' ? mode : 'psnr',
    psnr: integer(psnr, 20, 60, defaultJp2Options.psnr),
    ratio: integer(ratio, 2, 100, defaultJp2Options.ratio),
    lossless: lossless === true,
  };
}

export function effectiveJp2Options(options: Jp2Options): Jp2Settings {
  return options.lossless ? { mode: 'lossless' } : { mode: options.mode, value: options[options.mode] };
}

function suffix(options: Jp2Options): string {
  const settings = effectiveJp2Options(options);
  if (settings.mode === 'lossless') return 'lossless';
  return (settings.mode === 'psnr' ? 'psnr' : 'r') + settings.value;
}

export function jp2Key(generation: number, options: Jp2Options): string {
  return `${generation}:jp2:${suffix(options)}`;
}

export function jp2Filename(stem: string, side: string, options: Jp2Options): string {
  return `${stem}-${side}-openjpeg-${suffix(options)}.jp2`;
}
