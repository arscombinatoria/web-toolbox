import type { Jp2Settings } from './options';

export interface OpenJpegCodec {
  memory: WebAssembly.Memory;
  _initialize: () => void;
  malloc: (length: number) => number;
  free: (pointer: number) => void;
  jp2_encode: (input: number, width: number, height: number, mode: number, value: number) => number;
  jp2_output: () => number;
  jp2_output_size: () => number;
  jp2_clear_output: () => void;
  jp2_decode: (input: number, length: number, outputPointerSlot: number, generated: number) => number;
  jp2_width: () => number;
  jp2_height: () => number;
}

const MAX_SIDE = 8192;
const MAX_PIXELS = 16_000_000;
const MAX_INPUT_BYTES = 32 * 1024 * 1024;
// A noisy 16 MP RGBA lossless codestream can exceed the external file cap.
const MAX_GENERATED_BYTES = 128 * 1024 * 1024;

export async function instantiateOpenJpeg(binary: BufferSource): Promise<OpenJpegCodec> {
  let memory: WebAssembly.Memory | undefined;
  const { instance } = await WebAssembly.instantiate(binary, {
    env: { emscripten_notify_memory_growth: () => {} },
    wasi_snapshot_preview1: {
      environ_sizes_get: (countPointer: number, sizePointer: number) => {
        if (!memory || countPointer < 0 || sizePointer < 0 ||
            countPointer + 4 > memory.buffer.byteLength || sizePointer + 4 > memory.buffer.byteLength) return 21;
        const view = new DataView(memory.buffer);
        view.setUint32(countPointer, 0, true);
        view.setUint32(sizePointer, 0, true);
        return 0;
      },
      environ_get: () => 0,
    },
  });
  const codec = instance.exports as unknown as OpenJpegCodec;
  memory = codec.memory;
  codec._initialize();
  return codec;
}

function validatePixels(data: Uint8ClampedArray, width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS ||
      !(data instanceof Uint8ClampedArray) || data.byteLength !== width * height * 4) {
    throw new RangeError('JPEG 2000の寸法またはRGBAデータが不正です。');
  }
}

export function encodeJp2Pixels(
  codec: OpenJpegCodec,
  { data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>,
  settings: Jp2Settings,
): Uint8Array<ArrayBuffer> {
  validatePixels(data, width, height);
  let mode = 0;
  let value = 0;
  if (settings.mode === 'psnr') { mode = 1; value = settings.value; }
  else if (settings.mode === 'ratio') { mode = 2; value = settings.value; }
  else if (settings.mode !== 'lossless') throw new RangeError('JPEG 2000の圧縮設定が不正です。');
  if (mode && (!Number.isFinite(value) || value <= 0 || value > (mode === 1 ? 100 : 1000))) {
    throw new RangeError('JPEG 2000の圧縮設定が不正です。');
  }

  const input = codec.malloc(data.byteLength);
  if (input <= 0 || input + data.byteLength > codec.memory.buffer.byteLength) {
    if (input) codec.free(input);
    throw new Error('JPEG 2000 Wasmの入力メモリを確保できませんでした。');
  }
  try {
    new Uint8Array(codec.memory.buffer, input, data.byteLength).set(data);
    const result = codec.jp2_encode(input, width, height, mode, value);
    if (result !== 0) throw new Error(`JPEG 2000へ変換できませんでした（コード ${result}）。`);
    const pointer = codec.jp2_output();
    const length = codec.jp2_output_size();
    const memory = codec.memory.buffer;
    if (pointer <= 0 || !length || pointer + length > memory.byteLength) {
      throw new Error('JPEG 2000エンコーダーの出力領域が不正です。');
    }
    return new Uint8Array(memory, pointer, length).slice();
  } finally {
    codec.jp2_clear_output();
    codec.free(input);
  }
}

export function decodeJp2Pixels(
  codec: OpenJpegCodec,
  bytes: Uint8Array,
  generated = false,
): { data: Uint8ClampedArray<ArrayBuffer>; width: number; height: number } {
  const maxInput = generated ? MAX_GENERATED_BYTES : MAX_INPUT_BYTES;
  if (!(bytes instanceof Uint8Array) || bytes.byteLength < 4) {
    throw new TypeError('JPEG 2000ファイルの形式が正しくありません。');
  }
  if (bytes.byteLength > maxInput) {
    throw new RangeError('JPEG 2000ファイルのサイズが上限を超えています。');
  }
  const input = codec.malloc(bytes.byteLength);
  if (input <= 0 || input + bytes.byteLength > codec.memory.buffer.byteLength) {
    if (input) codec.free(input);
    throw new Error('JPEG 2000 Wasmの入力メモリを確保できませんでした。');
  }
  const outputSlot = codec.malloc(4);
  if (outputSlot <= 0 || outputSlot + 4 > codec.memory.buffer.byteLength) {
    if (outputSlot) codec.free(outputSlot);
    codec.free(input);
    throw new Error('JPEG 2000 Wasmの出力メモリを確保できませんでした。');
  }
  let outputPointer = 0;
  try {
    new Uint8Array(codec.memory.buffer, input, bytes.byteLength).set(bytes);
    new DataView(codec.memory.buffer).setUint32(outputSlot, 0, true);
    const result = codec.jp2_decode(input, bytes.byteLength, outputSlot, Number(generated));
    if (result === -4) throw new Error('このJPEG 2000の色形式、パレット、ICCプロファイル、またはアルファ構成には対応していません。');
    if (result === -5) throw new RangeError('JPEG 2000画像の寸法、タイル数、またはメモリ使用量が上限を超えています。');
    if (result !== 0) throw new Error('JPEG 2000ファイルが破損しているか、形式に対応していません。');
    outputPointer = new DataView(codec.memory.buffer).getUint32(outputSlot, true);
    const width = codec.jp2_width();
    const height = codec.jp2_height();
    const length = width * height * 4;
    const memory = codec.memory.buffer;
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
        outputPointer <= 0 || width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS ||
        outputPointer + length > memory.byteLength) {
      if (width > MAX_SIDE || height > MAX_SIDE || width * height > MAX_PIXELS) {
        throw new RangeError('JPEG 2000画像の寸法が上限を超えています。');
      }
      throw new Error('JPEG 2000デコーダーの出力領域が不正です。');
    }
    return { data: new Uint8ClampedArray(memory, outputPointer, length).slice(), width, height };
  } finally {
    if (outputPointer) codec.free(outputPointer);
    codec.free(outputSlot);
    codec.free(input);
  }
}
