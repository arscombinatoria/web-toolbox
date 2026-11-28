/// <reference lib="webworker" />
import wasmUrl from './openjpeg-2.5.4-8314119b-encoder-decoder.wasm?url&no-inline';
import { decodeJp2Pixels, encodeJp2Pixels, instantiateOpenJpeg } from './wasm';
import type { Jp2Settings } from './options';

export type Jp2Request = (
  | { kind: 'encode'; bitmap: ImageBitmap; settings: Jp2Settings }
  | { kind: 'decode'; bytes: ArrayBuffer }
) & { lockName?: string };

export type Jp2Reply =
  | { kind: 'encode'; bitmap: ImageBitmap; bytes: ArrayBuffer }
  | { kind: 'decode'; bitmap: ImageBitmap }
  | { error: string };

const worker = self as DedicatedWorkerGlobalScope;

function normalize(bitmap: ImageBitmap): ImageData {
  const { width, height } = bitmap;
  let canvas: OffscreenCanvas | undefined;
  try {
    if (width < 1 || height < 1 || width > 8192 || height > 8192 || width * height > 16_000_000) {
      throw new RangeError('画像は各辺8,192px以下、1,600万画素以下にしてください。');
    }
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('sRGB Canvas 2Dを使用できませんでした。');
    context.drawImage(bitmap, 0, 0);
    return context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

async function run(request: Jp2Request) {
  let preview: ImageBitmap | undefined;
  try {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`OpenJPEG Wasmを取得できませんでした（${response.status}）。`);
    const codec = await instantiateOpenJpeg(await response.arrayBuffer());
    const bytes = request.kind === 'encode'
      ? encodeJp2Pixels(codec, normalize(request.bitmap), request.settings)
      : new Uint8Array(request.bytes);
    const { data, width, height } = decodeJp2Pixels(codec, bytes, request.kind === 'encode');
    preview = await createImageBitmap(new ImageData(data, width, height, { colorSpace: 'srgb' }));
    if (request.kind === 'encode') {
      worker.postMessage({ kind: 'encode', bitmap: preview, bytes: bytes.buffer } satisfies Jp2Reply, [preview, bytes.buffer]);
    } else {
      worker.postMessage({ kind: 'decode', bitmap: preview } satisfies Jp2Reply, [preview]);
    }
  } finally {
    preview?.close();
  }
}

worker.addEventListener('message', async ({ data }: MessageEvent<Jp2Request>) => {
  const execute = async () => {
    try {
      await run(data);
    } catch (cause) {
      const error = cause instanceof Error && !(cause instanceof WebAssembly.RuntimeError)
        ? cause.message : 'JPEG 2000を処理できませんでした。画像サイズと形式を確認してください。';
      worker.postMessage({ error } satisfies Jp2Reply);
    } finally {
      if (data.kind === 'encode') data.bitmap.close();
    }
    // The browser releases the lock when the client terminates the Worker and reclaims Wasm memory.
    if (data.lockName) await new Promise<void>(() => {});
  };
  try {
    if (data.lockName) await worker.navigator.locks.request(data.lockName, execute);
    else await execute();
  } catch {
    if (data.kind === 'encode') data.bitmap.close();
    worker.postMessage({ error: 'OpenJPEG Workerを実行できませんでした。' } satisfies Jp2Reply);
  }
}, { once: true });
