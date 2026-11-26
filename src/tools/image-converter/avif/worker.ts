/// <reference lib="webworker" />
import factory from '@jsquash/avif/codec/enc/avif_enc.js';
import type { AVIFModule, EncodeOptions } from '@jsquash/avif/codec/enc/avif_enc.js';
import wasmUrl from '@jsquash/avif/codec/enc/avif_enc.wasm?url';
import type { AvifOptions } from './options';
import { effectiveAvifOptions, validateAvifOptions } from './options';
import { isAvifFtyp } from './ftyp';

interface RequestMessage { bitmap: ImageBitmap; options: AvifOptions; lockName?: string }
type ReplyMessage = { bytes: ArrayBuffer } | { error: string };
const worker = self as DedicatedWorkerGlobalScope;
const maxDimension = 8192;
const maxPixels = 16_000_000;
let wasm: Promise<AVIFModule> | undefined;

function getEncoder(): Promise<AVIFModule> {
  wasm ??= (async () => {
    const response = await fetch(wasmUrl);
    if (!response.ok) throw new Error(`AVIF Wasmを取得できませんでした（${response.status}）。`);
    const binary = await response.arrayBuffer();
    const module = await factory({ wasmBinary: binary, noInitialRun: true });
    return module;
  })();
  return wasm;
}

async function encode({ bitmap, options }: RequestMessage): Promise<ArrayBuffer> {
  const { width, height } = bitmap;
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > maxDimension || height > maxDimension || width * height > maxPixels) {
    throw new RangeError('画像は各辺8,192px以下、1,600万画素以下にしてください。');
  }
  let canvas: OffscreenCanvas | undefined;
  let pixels: ImageData;
  try {
    canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
    if (!context) throw new Error('sRGB Canvas 2D is unavailable');
    context.drawImage(bitmap, 0, 0);
    pixels = context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
    if (pixels.data.length !== width * height * 4 || pixels.data.constructor !== Uint8ClampedArray) {
      throw new Error('AVIF入力を8-bit sRGB RGBAに正規化できませんでした。');
    }
  } finally {
    bitmap.close();
    if (canvas) canvas.width = canvas.height = 0;
  }
  const module = await getEncoder();
  const effective = effectiveAvifOptions(validateAvifOptions(options));
  const encoderOptions: EncodeOptions = {
    ...effective,
    denoiseLevel: 0,
    tileRowsLog2: 0,
    tileColsLog2: 0,
    chromaDeltaQ: false,
    sharpness: 0,
    enableSharpYUV: false,
    tune: 0,
    bitDepth: 8,
  };
  const output = module.encode(pixels.data, width, height, encoderOptions);
  if (!output?.byteLength || !isAvifFtyp(output, output.byteLength)) {
    throw new Error('AVIFエンコーダーから妥当なAVIF画像を取得できませんでした。');
  }
  const bytes = output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
    ? output.buffer as ArrayBuffer
    : output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
  return bytes;
}

worker.addEventListener('message', async ({ data }: MessageEvent<RequestMessage>) => {
  const run = async () => {
    try {
      const bytes = await encode(data);
      worker.postMessage({ bytes } satisfies ReplyMessage, [bytes]);
      if (data.lockName) await new Promise<void>(() => {});
    } catch (cause) {
      worker.postMessage({ error: cause instanceof Error ? cause.message : 'AVIFへ変換できませんでした。' } satisfies ReplyMessage);
      if (data.lockName) await new Promise<void>(() => {});
    }
  };
  if (!data.lockName) return void run();
  try {
    await worker.navigator.locks.request(data.lockName, run);
  } catch (cause) {
    data.bitmap.close();
    worker.postMessage({ error: cause instanceof Error ? cause.message : 'AVIF Workerを実行できませんでした。' } satisfies ReplyMessage);
  }
}, { once: true });
