import { isMozjpeg } from './jpeg';
import type { MozjpegOptions } from './options';
import { imageWorkerLockName, runHeavyWorker } from '../worker-slot';

type MozjpegWorkerRequest = { bitmap: ImageBitmap; options: MozjpegOptions; lockName?: string };
type MozjpegWorkerReply = { bytes: ArrayBuffer } | { error: string };

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

export async function encodeMozjpeg(bitmap: ImageBitmap, options: MozjpegOptions, signal: AbortSignal, onStart: () => void): Promise<Blob> {
  const { width, height } = bitmap;
  return runHeavyWorker(signal, async () => {
    const copy = await cloneBitmap(bitmap, signal);
    try {
      signal.throwIfAborted();
      onStart();
      const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'image-converter-mozjpeg' });
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
          else reject(new Error('MozJPEG Workerから出力を受け取れませんでした。'));
        };
        const abort = () => finish(signal.reason);
        signal.addEventListener('abort', abort, { once: true });
        worker.onmessage = ({ data }: MessageEvent<unknown>) => {
          if (!data || typeof data !== 'object') return finish(new Error('MozJPEG Workerの応答を確認できません。'));
          const reply = data as MozjpegWorkerReply;
          if ('bytes' in reply && reply.bytes instanceof ArrayBuffer && isMozjpeg(new Uint8Array(reply.bytes), width, height, options)) finish(undefined, reply.bytes);
          else finish(new Error('error' in reply && typeof reply.error === 'string' ? reply.error : 'MozJPEG Workerの応答を確認できません。'));
        };
        worker.onerror = worker.onmessageerror = () => finish(new Error('MozJPEG Workerを実行できませんでした。'));
        try {
          const request: MozjpegWorkerRequest = { bitmap: copy, options };
          if (navigator.locks) request.lockName = imageWorkerLockName;
          worker.postMessage(request, [copy]);
        } catch (error) {
          finish(error);
        }
      });
      signal.throwIfAborted();
      return new Blob([bytes], { type: 'image/jpeg' });
    } finally {
      copy.close();
    }
  });
}
