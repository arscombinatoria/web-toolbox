/// <reference lib="webworker" />
import wasmUrl from './jpegli-c7d342c25d3587ac0110c915989ad94f414b6c8d-encoder.wasm?url&no-inline';
import { validateJpegliOptions, type JpegliOptions } from './options';
import { isJpegli } from './jpeg';
import { encodeJpegliPixels, instantiateJpegli, validJpegliDimensions } from './wasm';
import { drawOnWhite } from '../paint';

interface RequestMessage { bitmap: ImageBitmap; options: JpegliOptions; lockName?: string }
type ReplyMessage = { bytes: ArrayBuffer } | { error: string };
const worker = self as DedicatedWorkerGlobalScope;

function normalize(bitmap: ImageBitmap): ImageData {
  let canvas: OffscreenCanvas | undefined;
  try {
    const { width, height } = bitmap;
    if (!validJpegliDimensions(width, height)) {
      throw new RangeError('画像は各辺8,192px以下、1,600万画素以下にしてください。');
    }
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('sRGB Canvas 2Dを使用できませんでした。');
    drawOnWhite(context, bitmap);
    const pixels = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
    if (pixels.data.length !== width * height * 4 || !(pixels.data instanceof Uint8ClampedArray)) {
      throw new Error('Jpegli入力を8-bit sRGB RGBAに正規化できませんでした。');
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
  if (!response.ok) throw new Error(`Jpegli Wasmを取得できませんでした（${response.status}）。`);
  const encoder = await instantiateJpegli(await response.arrayBuffer());
  const config = validateJpegliOptions(options);
  const output = encodeJpegliPixels(encoder, pixels, config);
  if (!isJpegli(output, pixels.width, pixels.height, config)) throw new Error('Jpegliエンコーダーから妥当なJPEG画像を取得できませんでした。');
  return output.buffer;
}

worker.addEventListener('message', async ({ data }: MessageEvent<RequestMessage>) => {
  const run = async () => {
    try {
      const bytes = await encode(data);
      worker.postMessage({ bytes } satisfies ReplyMessage, [bytes]);
    } catch (cause) {
      worker.postMessage({ error: cause instanceof Error ? cause.message : 'Jpegliへ変換できませんでした。' } satisfies ReplyMessage);
    }
    // Hold the common lock until the browser destroys this Worker and its memory.
    if (data.lockName) await new Promise<void>(() => {});
  };
  if (!data.lockName) return void run();
  try {
    await worker.navigator.locks.request(data.lockName, run);
  } catch (cause) {
    data.bitmap.close();
    worker.postMessage({ error: cause instanceof Error ? cause.message : 'Jpegli Workerを実行できませんでした。' } satisfies ReplyMessage);
  }
}, { once: true });
