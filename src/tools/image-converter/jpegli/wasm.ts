import { effectiveJpegliOptions, type JpegliOptions } from './options';

interface EncoderExports {
  memory: WebAssembly.Memory;
  _initialize: () => void;
  malloc: (length: number) => number;
  free: (pointer: number) => void;
  jpegli_encode: (input: number, length: number, width: number, height: number, mode: number, value: number,
    subsample: number, progressiveLevel: number, adaptiveQuantization: number, optimizeCoding: number, result: number) => number;
}

export async function instantiateJpegli(binary: BufferSource): Promise<EncoderExports> {
  // The encoder has no file descriptors. Jpegli's stdio diagnostics can
  // reach these libc imports, so explicitly reject file operations (WASI EBADF).
  const badFileDescriptor = () => 8;
  const { instance } = await WebAssembly.instantiate(binary, {
    env: { emscripten_notify_memory_growth: () => {} },
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => { throw new Error(`Jpegli Wasmが終了しました（${code}）。`); },
      fd_close: badFileDescriptor,
      fd_seek: badFileDescriptor,
      fd_write: badFileDescriptor,
    },
  });
  const encoder = instance.exports as unknown as EncoderExports;
  encoder._initialize();
  return encoder;
}

export function validJpegliDimensions(width: number, height: number): boolean {
  return Number.isInteger(width) && Number.isInteger(height) && width >= 1 && height >= 1 &&
    width <= 8192 && height <= 8192 && width * height <= 16_000_000;
}

export function encodeJpegliPixels(encoder: EncoderExports, pixels: Pick<ImageData, 'width' | 'height' | 'data'>,
  options: JpegliOptions): Uint8Array<ArrayBuffer> {
  const { data, width, height } = pixels;
  if (!validJpegliDimensions(width, height) || !(data instanceof Uint8ClampedArray) || data.length !== width * height * 4) {
    throw new RangeError('Jpegliの入力画素を確認できません。');
  }
  const input = encoder.malloc(data.byteLength);
  if (!input) throw new Error('Jpegliの入力メモリを確保できませんでした。');
  let result = 0;
  let output = 0;
  try {
    result = encoder.malloc(8);
    if (!result) throw new Error('Jpegliの結果用メモリを確保できませんでした。');
    new Uint8Array(encoder.memory.buffer, input, data.byteLength).set(data);
    const config = effectiveJpegliOptions(options);
    const distanceMode = config.mode === 'distance';
    const value = distanceMode ? Math.round(config.distance * 10) : config.quality;
    const status = encoder.jpegli_encode(input, data.byteLength, width, height, Number(distanceMode), value,
      Number(config.subsample), config.progressiveLevel, Number(config.adaptiveQuantization), Number(config.optimizeCoding), result);
    if (status !== 0) throw new Error(`Jpegliへ変換できませんでした（${status}）。`);
    // Encoding can grow memory and detach earlier views.
    const memory = encoder.memory.buffer;
    const fields = new DataView(memory, result, 8);
    const pointer = fields.getUint32(0, true);
    const length = fields.getUint32(4, true);
    if (!pointer || !length || pointer > memory.byteLength || length > memory.byteLength - pointer ||
        (pointer < input + data.byteLength && input < pointer + length) ||
        (pointer < result + 8 && result < pointer + length)) {
      throw new Error('Jpegliの出力メモリ範囲を確認できません。');
    }
    output = pointer;
    return new Uint8Array(memory, output, length).slice();
  } finally {
    if (output) encoder.free(output);
    if (result) encoder.free(result);
    encoder.free(input);
  }
}
