import type { EncoderId } from '../encoder';

export const MAX_EVALUATION_PIXELS = 10_000_000;
export const MIN_EVALUATION_SIDE = 8;

export function evaluationLimit(width: number, height: number): string | undefined {
  if (!Number.isInteger(width) || !Number.isInteger(height) ||
      width < MIN_EVALUATION_SIDE || height < MIN_EVALUATION_SIDE) {
    return '画質評価には各辺8 px以上が必要です。';
  }
  if (width * height > MAX_EVALUATION_PIXELS) {
    return '画質評価は' + MAX_EVALUATION_PIXELS.toLocaleString('ja-JP') + '画素以下の画像に対応しています。変換と保存は利用できます。';
  }
}

export function isEvaluable(encoder: EncoderId, lossless = false): boolean {
  return encoder === 'image/jpeg' || ((encoder === 'image/avif' || encoder === 'image/webp') && !lossless);
}

export function isFiniteScore(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}
