import { evaluationLimit, isFiniteScore } from './rules';
import type { EvaluationRequest } from './worker';
import { imageWorkerLockName, runHeavyWorker } from '../worker-slot';

export async function evaluateImages(
  reference: ImageBitmap,
  images: readonly Blob[],
  signal: AbortSignal,
  onStart: () => void,
  onScore: (image: Blob, score: number) => void,
  onUnsupportedJxl: () => void,
): Promise<void> {
  signal.throwIfAborted();
  const limit = evaluationLimit(reference.width, reference.height);
  if (limit) throw new RangeError(limit);
  if (!images.length) return;

  await runHeavyWorker(signal, async () => {
    const copy = await createImageBitmap(reference);
    try {
      signal.throwIfAborted();
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'image-quality-ssimulacra2' });
      await new Promise<void>((resolve, reject) => {
        let index = 0;
        let finished = false;
        const fail = () => finish(new Error('画質を評価できませんでした。もう一度お試しください。'));
        const abort = () => finish(signal.reason);
        function finish(error?: unknown) {
          if (finished) return;
          finished = true;
          signal.removeEventListener('abort', abort);
          worker.onmessage = worker.onerror = worker.onmessageerror = null;
          worker.terminate();
          if (error !== undefined) reject(error);
          else resolve();
        }

        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (finished) return;
          if (!data || typeof data !== 'object' || !('index' in data) || data.index !== index) {
            fail();
            return;
          }
          try {
            if ('score' in data && isFiniteScore(data.score)) onScore(images[index]!, data.score);
            else if ('unsupported' in data && data.unsupported === 'image/jxl' && images[index]!.type === 'image/jxl') onUnsupportedJxl();
            else return fail();
            index++;
            if (index === images.length) finish();
          } catch (error) {
            finish(error);
          }
        };
        worker.onerror = worker.onmessageerror = fail;
        try {
          const request: EvaluationRequest = { reference: copy, images };
          if (navigator.locks) request.lockName = imageWorkerLockName;
          onStart();
          worker.postMessage(request, [copy]);
        } catch (error) {
          finish(error);
        }
      });
    } finally {
      copy.close();
    }
  });
}
