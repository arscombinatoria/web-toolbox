import { jp2InputType } from './signature';
import type { Jp2Settings } from './options';
import type { Jp2Reply, Jp2Request } from './worker';
import { imageWorkerLockName, runHeavyWorker } from '../worker-slot';

export interface Jp2Result {
  blob: Blob;
  bitmap: ImageBitmap;
}

function requestWorker(request: Jp2Request, transfer: Transferable[], signal: AbortSignal): Promise<unknown> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module', name: 'image-converter-openjpeg' });
  return new Promise((resolve, reject) => {
    const finish = () => {
      signal.removeEventListener('abort', abort);
      worker.onmessage = worker.onerror = worker.onmessageerror = null;
      worker.terminate();
    };
    const abort = () => {
      finish();
      reject(signal.reason);
    };
    const fail = (error: unknown) => {
      finish();
      reject(error);
    };
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<unknown>) => {
      finish();
      resolve(data);
    };
    worker.onerror = worker.onmessageerror = () => fail(new Error('OpenJPEG Workerを実行できませんでした。'));
    try {
      if (navigator.locks) request.lockName = imageWorkerLockName;
      worker.postMessage(request, transfer);
    } catch (error) {
      fail(error);
    }
  });
}

function validatedReply(data: unknown): Extract<Jp2Reply, { bitmap: ImageBitmap }> {
  if (data && typeof data === 'object') {
    if ('bitmap' in data && data.bitmap instanceof ImageBitmap) {
      const { width, height } = data.bitmap;
      const valid = width > 0 && height > 0 && width <= 8192 && height <= 8192 && width * height <= 16_000_000;
      if (valid && 'kind' in data) {
        if (data.kind === 'decode') return { kind: 'decode', bitmap: data.bitmap };
        if (data.kind === 'encode' && 'bytes' in data && data.bytes instanceof ArrayBuffer) {
          return { kind: 'encode', bitmap: data.bitmap, bytes: data.bytes };
        }
      }
      data.bitmap.close();
    }
    if ('error' in data && typeof data.error === 'string') throw new Error(data.error);
  }
  throw new Error('OpenJPEG Workerの応答を確認できません。');
}

export function encodeJp2(
  bitmap: ImageBitmap, settings: Jp2Settings, signal: AbortSignal, onStart: () => void,
): Promise<Jp2Result> {
  const { width, height } = bitmap;
  return runHeavyWorker(signal, async () => {
    const copy = await createImageBitmap(bitmap);
    try {
      signal.throwIfAborted();
      onStart();
      const data = validatedReply(await requestWorker({ kind: 'encode', bitmap: copy, settings }, [copy], signal));
      try {
        signal.throwIfAborted();
        if (data.kind !== 'encode' ||
            jp2InputType(new Uint8Array(data.bytes)) !== 'image/jp2' ||
            data.bitmap.width !== width || data.bitmap.height !== height) {
          throw new Error('OpenJPEG Workerの変換結果を確認できません。');
        }
        return { blob: new Blob([data.bytes], { type: 'image/jp2' }), bitmap: data.bitmap };
      } catch (error) {
        data.bitmap.close();
        throw error;
      }
    } finally {
      copy.close();
    }
  });
}

export function decodeJp2(file: Blob, signal: AbortSignal): Promise<ImageBitmap> {
  if (file.size > 32 * 1024 * 1024) return Promise.reject(new RangeError('32 MiB以下の画像を選択してください。'));
  return runHeavyWorker(signal, async () => {
    const bytes = await file.arrayBuffer();
    signal.throwIfAborted();
    const data = validatedReply(await requestWorker({ kind: 'decode', bytes }, [bytes], signal));
    if (signal.aborted || data.kind !== 'decode') {
      data.bitmap.close();
      signal.throwIfAborted();
      throw new Error('OpenJPEG Workerのデコード結果を確認できません。');
    }
    return data.bitmap;
  });
}
