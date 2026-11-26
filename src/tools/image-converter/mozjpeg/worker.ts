/// <reference lib="webworker" />
import wasmUrl from './mozjpeg-4.1.5-encoder.wasm?url&no-inline';
import { validateMozjpegOptions, type MozjpegOptions } from './options';
import { isMozjpeg } from './jpeg';
import { encodeMozjpegPixels, instantiateMozjpeg, validMozjpegDimensions } from './wasm';
import { drawOnWhite } from '../paint';

interface RequestMessage { bitmap: ImageBitmap; options: MozjpegOptions; lockName?: string }
type ReplyMessage = { bytes: ArrayBuffer } | { error: string };
const worker = self as DedicatedWorkerGlobalScope;

function normalize(bitmap: ImageBitmap): ImageData {
  let canvas: OffscreenCanvas | undefined;
  try {
    const { width, height } = bitmap;
    if (!validMozjpegDimensions(width, height)) {
      throw new RangeError('画像は各辺8,192px以下、1,600万画素以下にしてください。');
    }
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('sRGB Canvas 2Dを使用できませんでした。');
    drawOnWhite(context, bitmap);
    const pixels = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
    if (pixels.data.length !== width * height * 4 || !(pixels.data instanceof Uint8ClampedArray)) {
      throw new Error('MozJPEG入力を8-bit sRGB RGBAに正規化できませんでした。');
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
  if (!response.ok) throw new Error(`MozJPEG Wasmを取得できませんでした（${response.status}）。`);
  const encoder = await instantiateMozjpeg(await response.arrayBuffer());
  const config = validateMozjpegOptions(options);
  const output = encodeMozjpegPixels(encoder, pixels, config);
  if (!isMozjpeg(output, pixels.width, pixels.height, config)) throw new Error('MozJPEGエンコーダーから妥当なJPEG画像を取得できませんでした。');
  return output.buffer;
}

worker.addEventListener('message', async ({ data }: MessageEvent<RequestMessage>) => {
  const run = async () => {
    try {
      const bytes = await encode(data);
      worker.postMessage({ bytes } satisfies ReplyMessage, [bytes]);
    } catch (cause) {
      worker.postMessage({ error: cause instanceof Error ? cause.message : 'MozJPEGへ変換できませんでした。' } satisfies ReplyMessage);
    }
    // Hold the common lock until the browser destroys this Worker and its memory.
    if (data.lockName) await new Promise<void>(() => {});
  };
  if (!data.lockName) return void run();
  try {
    await worker.navigator.locks.request(data.lockName, run);
  } catch (cause) {
    data.bitmap.close();
    worker.postMessage({ error: cause instanceof Error ? cause.message : 'MozJPEG Workerを実行できませんでした。' } satisfies ReplyMessage);
  }
}, { once: true });
