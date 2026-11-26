/// <reference lib="webworker" />
import { drawOnWhite } from '../paint';
import { evaluationLimit } from './rules';
import { loadScorer, scoreImages } from './wasm';

export interface EvaluationRequest {
  reference: ImageBitmap;
  images: readonly Blob[];
  lockName?: string;
}

export type EvaluationReply = { index: number; score: number } | { error: true };

const worker = self as DedicatedWorkerGlobalScope;

async function evaluate({ reference, images }: EvaluationRequest) {
  try {
    const { width, height } = reference;
    const limit = evaluationLimit(width, height);
    if (limit) throw new RangeError(limit);

    const canvas = new OffscreenCanvas(width, height);
    try {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (!context) throw new Error('sRGB Canvas 2D is unavailable');
      const readPixels = (image: ImageBitmap) => {
        if (image.width !== width || image.height !== height) throw new RangeError('画像寸法が一致しません。');
        drawOnWhite(context, image);
        return context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
      };

      const original = readPixels(reference);
      const scorer = await loadScorer();
      for (const [index, image] of images.entries()) {
        const decoded = await createImageBitmap(image, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });
        let score: number;
        try {
          score = scoreImages(scorer, original, readPixels(decoded));
        } finally {
          decoded.close();
        }
        worker.postMessage({ index, score } satisfies EvaluationReply);
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
  } catch {
    worker.postMessage({ error: true } satisfies EvaluationReply);
  } finally {
    reference.close();
  }
}

worker.addEventListener('message', async ({ data }: MessageEvent<EvaluationRequest>) => {
  if (!data.lockName) {
    await evaluate(data);
    return;
  }

  try {
    await worker.navigator.locks.request(data.lockName, async () => {
      await evaluate(data);
      // The browser releases the lock when the Worker is destroyed, including on cancellation.
      await new Promise<void>(() => {});
    });
  } catch {
    data.reference.close();
    worker.postMessage({ error: true } satisfies EvaluationReply);
  }
}, { once: true });
