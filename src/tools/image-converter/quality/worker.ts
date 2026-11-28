/// <reference lib="webworker" />
import { drawOnWhite } from '../paint';
import { jxlProbeBlob } from '../jxl/support';
import { evaluationLimit } from './rules';
import { loadScorer, scoreImages } from './wasm';

export interface EvaluationRequest {
  reference: ImageBitmap;
  images: readonly (Blob | { bitmap: ImageBitmap })[];
  lockName?: string;
}

export type EvaluationReply = { index: number; score: number } | { index: number; unsupported: 'image/jxl' } | { error: true };

const worker = self as DedicatedWorkerGlobalScope;
const decodeBlob = (image: Blob) => createImageBitmap(image, { imageOrientation: 'from-image', colorSpaceConversion: 'default' });

async function supportsJxl(): Promise<boolean> {
  try {
    const bitmap = await decodeBlob(jxlProbeBlob());
    try {
      return bitmap.width === 2 && bitmap.height === 2;
    } finally {
      bitmap.close();
    }
  } catch {
    return false;
  }
}

async function evaluate({ reference, images }: EvaluationRequest) {
  try {
    const { width, height } = reference;
    const limit = evaluationLimit(width, height);
    if (limit) throw new RangeError(limit);

    const canDecodeJxl = !images.some(image => image instanceof Blob && image.type === 'image/jxl') || await supportsJxl();
    const reportUnsupportedJxl = (index: number) => worker.postMessage({ index, unsupported: 'image/jxl' } satisfies EvaluationReply);
    if (!canDecodeJxl && images.every(image => image instanceof Blob && image.type === 'image/jxl')) {
      images.forEach((_, index) => reportUnsupportedJxl(index));
      return;
    }
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
      let scorer: Awaited<ReturnType<typeof loadScorer>> | undefined;
      for (const [index, image] of images.entries()) {
        if (image instanceof Blob && image.type === 'image/jxl' && !canDecodeJxl) {
          reportUnsupportedJxl(index);
          continue;
        }
        scorer ??= await loadScorer();
        const decoded = image instanceof Blob ? await decodeBlob(image) : image.bitmap;
        let score: number;
        try {
          score = scoreImages(scorer, original, readPixels(decoded));
        } finally {
          if (image instanceof Blob) decoded.close();
        }
        worker.postMessage({ index, score } satisfies EvaluationReply);
      }
    } finally {
      canvas.width = canvas.height = 0;
    }
  } catch {
    worker.postMessage({ error: true } satisfies EvaluationReply);
  } finally {
    closeRequest({ reference, images });
  }
}

function closeRequest({ reference, images }: EvaluationRequest) {
  reference.close();
  for (const image of images) {
    if (!(image instanceof Blob)) image.bitmap.close();
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
    closeRequest(data);
    worker.postMessage({ error: true } satisfies EvaluationReply);
  }
}, { once: true });
