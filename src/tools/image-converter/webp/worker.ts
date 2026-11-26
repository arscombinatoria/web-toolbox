/// <reference lib="webworker" />
import wasmUrl from './libwebp-1.6.0-encoder.wasm?url&no-inline';
import { validateWebpOptions, type WebpOptions } from './options';
import { isWebp } from './riff';
import { encodeWebpPixels, instantiateWebp } from './wasm';

interface RequestMessage { bitmap: ImageBitmap; options: WebpOptions; lockName?: string }
type ReplyMessage = { bytes: ArrayBuffer } | { error: string };
const worker = self as DedicatedWorkerGlobalScope;

function normalize(bitmap: ImageBitmap): ImageData {
  let canvas: OffscreenCanvas | undefined;
  try {
    const { width, height } = bitmap;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        width > 8192 || height > 8192 || width * height > 16_000_000) {
      throw new RangeError('画像は各辺8,192px以下、1,600万画素以下にしてください。');
    }
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('sRGB Canvas 2Dを使用できませんでした。');
    context.drawImage(bitmap, 0, 0);
    const pixels = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
    if (pixels.data.length !== width * height * 4 || !(pixels.data instanceof Uint8ClampedArray)) {
      throw new Error('WebP入力を8-bit sRGB RGBAに正規化できませんでした。');
    }
    return pixels;
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
}

async function encode({ bitmap, options }: RequestMessage): Promise<ArrayBuffer> {
  const pixels = normalize(bitmap);
  const response = await fetch(wasmUrl);
  if (!response.ok) throw new Error(`WebP Wasmを取得できませんでした（${response.status}）。`);
  const encoder = await instantiateWebp(await response.arrayBuffer());
  const output = encodeWebpPixels(encoder, pixels, validateWebpOptions(options));
  if (!isWebp(output)) throw new Error('WebPエンコーダーから妥当なWebP画像を取得できませんでした。');
  return output.buffer;
}

worker.addEventListener('message', async ({ data }: MessageEvent<RequestMessage>) => {
  const run = async () => {
    try {
      const bytes = await encode(data);
      worker.postMessage({ bytes } satisfies ReplyMessage, [bytes]);
    } catch (cause) {
      worker.postMessage({ error: cause instanceof Error ? cause.message : 'WebPへ変換できませんでした。' } satisfies ReplyMessage);
    }
    // Hold the common lock until the browser destroys this Worker and its memory.
    if (data.lockName) await new Promise<void>(() => {});
  };
  if (!data.lockName) return void run();
  try {
    await worker.navigator.locks.request(data.lockName, run);
  } catch (cause) {
    data.bitmap.close();
    worker.postMessage({ error: cause instanceof Error ? cause.message : 'WebP Workerを実行できませんでした。' } satisfies ReplyMessage);
  }
}, { once: true });
