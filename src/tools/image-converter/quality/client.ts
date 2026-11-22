import { evaluationLimit, isFiniteScore } from './rules';
import type { EvaluationRequest } from './worker';

let workerLockName: string | undefined;

export async function evaluateJpegs(
  reference: ImageBitmap,
  jpegs: readonly Blob[],
  signal: AbortSignal,
  onStart: () => void,
  onScore: (jpeg: Blob, score: number) => void,
): Promise<void> {
  signal.throwIfAborted();
  const limit = evaluationLimit(reference.width, reference.height);
  if (limit) throw new RangeError(limit);
  if (!jpegs.length) return;

  const locks = navigator.locks;
  let lockName: string | undefined;
  if (locks) {
    // Keep the name across mounts so a quick return to the tool also waits for cleanup.
    workerLockName ??= 'web-toolbox:image-quality:' + crypto.getRandomValues(new Uint32Array(4)).join('-');
    lockName = workerLockName;
    // terminate() can return before the browser has reclaimed a Worker running Wasm.
    await locks.request(lockName, { signal }, () => {});
    signal.throwIfAborted();
  }

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
        const request: EvaluationRequest = { reference: copy, jpegs };
        if (lockName) request.lockName = lockName;
        onStart();
        worker.postMessage(request, [copy]);
      } catch (error) {
        finish(error);
      }
    });
  } finally {
    copy.close();
  }
}
