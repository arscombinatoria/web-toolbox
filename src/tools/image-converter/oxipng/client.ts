import type { OxipngOptions } from './options';
import { imageWorkerLockName, runHeavyWorker } from '../worker-slot';

type OxipngWorkerRequest = { bitmap: ImageBitmap; options: OxipngOptions; lockName?: string };
type OxipngWorkerReply = { bytes: ArrayBuffer } | { error: string };

export async function encodeOxipng(bitmap: ImageBitmap, options: OxipngOptions, signal: AbortSignal, onStart: () => void): Promise<Blob> {
  return runHeavyWorker(signal, async () => {
    const copy = await createImageBitmap(bitmap);
    try {
      signal.throwIfAborted();
      onStart();
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'image-converter-oxipng' });
      const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
          let finished = false;
          const finish = (error?: unknown, output?: ArrayBuffer) => {
            if (finished) return;
            finished = true;
            signal.removeEventListener('abort', abort);
            worker.onmessage = worker.onerror = worker.onmessageerror = null;
            worker.terminate();
            if (error !== undefined) reject(error);
            else if (output) resolve(output);
            else reject(new Error('Oxipngから出力を受け取れませんでした。'));
          };
          const abort = () => finish(signal.reason);
          signal.addEventListener('abort', abort, { once: true });
          worker.onmessage = ({ data }: MessageEvent<unknown>) => {
            if (!data || typeof data !== 'object') return finish(new Error('Oxipngの応答を確認できません。'));
            const reply = data as OxipngWorkerReply;
            if ('bytes' in reply && reply.bytes instanceof ArrayBuffer && reply.bytes.byteLength >= 8) finish(undefined, reply.bytes);
            else finish(new Error('error' in reply && typeof reply.error === 'string' ? reply.error : 'Oxipngの応答を確認できません。'));
          };
          worker.onerror = worker.onmessageerror = () => finish(new Error('Oxipng Workerを実行できませんでした。'));
          try {
            const request: OxipngWorkerRequest = { bitmap: copy, options };
            if (navigator.locks) request.lockName = imageWorkerLockName;
            worker.postMessage(request, [copy]);
          } catch (error) {
            finish(error);
          }
      });
      signal.throwIfAborted();
      return new Blob([bytes], { type: 'image/png' });
    } finally {
      copy.close();
    }
  });
}
