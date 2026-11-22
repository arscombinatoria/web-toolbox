import { evaluationLimit, isFiniteScore } from './rules';
import type { EvaluationRequest } from './worker';

export async function evaluateJpegs(
  reference: ImageBitmap,
  jpegs: readonly Blob[],
  signal: AbortSignal,
  onScore: (jpeg: Blob, score: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  const limit = evaluationLimit(reference.width, reference.height);
  if (limit) throw new RangeError(limit);
  if (!jpegs.length) return;

  // Transfer a copy so the original bitmap remains available for preview and encoding.
  const copy = await createImageBitmap(reference);
  try {
    signal.throwIfAborted();
    const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
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
        if (!data || typeof data !== 'object' || !('index' in data) || data.index !== index ||
            !('score' in data) || !isFiniteScore(data.score)) {
          fail();
          return;
        }
        try {
          onScore(jpegs[index]!, data.score);
          index++;
          if (index === jpegs.length) finish();
        } catch (error) {
          finish(error);
        }
      };
      worker.onerror = worker.onmessageerror = fail;
      try {
        worker.postMessage({ reference: copy, jpegs } satisfies EvaluationRequest, [copy]);
      } catch (error) {
        finish(error);
      }
    });
  } finally {
    copy.close();
  }
}
