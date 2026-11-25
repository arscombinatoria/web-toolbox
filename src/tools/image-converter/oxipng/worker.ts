/// <reference lib="webworker" />
import init, { optimise_raw } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import type { InitOutput } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import wasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url';
import type { OxipngOptions } from './options';

interface RequestMessage { bitmap: ImageBitmap; options: OxipngOptions; lockName?: string }
type ReplyMessage = { bytes: ArrayBuffer } | { error: string };
const worker = self as DedicatedWorkerGlobalScope;
let wasm: Promise<InitOutput> | undefined;

async function encode({ bitmap, options }: RequestMessage): Promise<ArrayBuffer> {
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    try {
      const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: true });
      if (!context) throw new Error('sRGB Canvas 2D is unavailable');
      context.drawImage(bitmap, 0, 0);
      const pixels = context.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: 'srgb' });
      const { width, height } = bitmap;
      bitmap.close();
      canvas.width = canvas.height = 0;
      wasm ??= init(wasmUrl);
      await wasm;
      const output = optimise_raw(pixels.data, width, height,
        options.level, options.interlace, options.optimiseAlpha);
      return output.byteOffset === 0 && output.byteLength === output.buffer.byteLength
        ? output.buffer as ArrayBuffer
        : output.buffer.slice(output.byteOffset, output.byteOffset + output.byteLength) as ArrayBuffer;
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    bitmap.close();
  }
}

worker.addEventListener('message', async ({ data }: MessageEvent<RequestMessage>) => {
  const run = async () => {
    try {
      const bytes = await encode(data);
      worker.postMessage({ bytes } satisfies ReplyMessage, [bytes]);
      // Keep the origin-wide lock until the client terminates this Worker.
      if (data.lockName) await new Promise<void>(() => {});
    } catch (cause) {
      worker.postMessage({ error: cause instanceof Error ? cause.message : 'Oxipngで画像を変換できませんでした。' } satisfies ReplyMessage);
      if (data.lockName) await new Promise<void>(() => {});
    }
  };
  if (!data.lockName) return void run();
  try {
    await worker.navigator.locks.request(data.lockName, run);
  } catch (cause) {
    data.bitmap.close();
    worker.postMessage({ error: cause instanceof Error ? cause.message : 'Oxipng Workerを実行できませんでした。' } satisfies ReplyMessage);
  }
}, { once: true });
