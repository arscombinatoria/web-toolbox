export interface OxipngOptions {
  level: number;
  interlace: boolean;
  optimiseAlpha: boolean;
}

export const defaultOxipngOptions: OxipngOptions = {
  level: 2,
  interlace: false,
  optimiseAlpha: false,
};

export function validateOxipngOptions(value: unknown): OxipngOptions {
  if (!value || typeof value !== 'object') return { ...defaultOxipngOptions };
  const candidate = value as Record<string, unknown>;
  return {
    level: typeof candidate.level === 'number' && Number.isInteger(candidate.level) && candidate.level >= 1 && candidate.level <= 6
      ? candidate.level : defaultOxipngOptions.level,
    interlace: typeof candidate.interlace === 'boolean' ? candidate.interlace : defaultOxipngOptions.interlace,
    optimiseAlpha: typeof candidate.optimiseAlpha === 'boolean' ? candidate.optimiseAlpha : defaultOxipngOptions.optimiseAlpha,
  };
}

export function oxipngKey(generation: number, options: OxipngOptions): string {
  return [generation, 'oxipng', options.level, Number(options.interlace), Number(options.optimiseAlpha)].join(':');
}
