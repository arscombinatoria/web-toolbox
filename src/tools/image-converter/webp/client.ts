import { isWebp } from './riff';
import type { WebpOptions } from './options';
import { imageWorkerLockName, runHeavyWorker } from '../worker-slot';

type WebpWorkerRequest = { bitmap: ImageBitmap; options: WebpOptions; lockName?: string };
type WebpWorkerReply = { bytes: ArrayBuffer } | { error: string };

async function cloneBitmap(bitmap: ImageBitmap, signal: AbortSignal): Promise<ImageBitmap> {
  signal.throwIfAborted();
  const cloning = createImageBitmap(bitmap);
  try {
    return await new Promise<ImageBitmap>((resolve, reject) => {
      const abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      cloning.then(value => {
        signal.removeEventListener('abort', abort);
        resolve(value);
      }, error => {
        signal.removeEventListener('abort', abort);
        reject(error);
      });
    });
  } catch (error) {
    void cloning.then(copy => copy.close(), () => {});
    throw error;
  }
}

export async function encodeWebp(bitmap: ImageBitmap, options: WebpOptions, signal: AbortSignal, onStart: () => void): Promise<Blob> {
  return runHeavyWorker(signal, async () => {
    const copy = await cloneBitmap(bitmap, signal);
    try {
      signal.throwIfAborted();
      onStart();
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'image-converter-webp' });
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
          else reject(new Error('WebP Workerから出力を受け取れませんでした。'));
        };
        const abort = () => finish(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (!data || typeof data !== 'object') return finish(new Error('WebP Workerの応答を確認できません。'));
          const reply = data as WebpWorkerReply;
          if ('bytes' in reply && reply.bytes instanceof ArrayBuffer && isWebp(new Uint8Array(reply.bytes))) finish(undefined, reply.bytes);
          else finish(new Error('error' in reply && typeof reply.error === 'string' ? reply.error : 'WebP Workerの応答を確認できません。'));
        };
        worker.onerror = worker.onmessageerror = () => finish(new Error('WebP Workerを実行できませんでした。'));
        try {
          const request: WebpWorkerRequest = { bitmap: copy, options };
          if (navigator.locks) request.lockName = imageWorkerLockName;
          worker.postMessage(request, [copy]);
        } catch (error) {
          finish(error);
        }
      });
      signal.throwIfAborted();
      return new Blob([bytes], { type: 'image/webp' });
    } finally {
      copy.close();
    }
  });
}
