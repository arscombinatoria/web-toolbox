import { effectiveJxlOptions, type JxlOptions } from './options';
import { isJxl } from './signature';

interface EncoderExports {
  memory: WebAssembly.Memory;
  _initialize: () => void;
  JxlEncoderVersion: () => number;
  malloc: (length: number) => number;
  free: (pointer: number) => void;
  jxl_encode: (pointer: number, length: number, width: number, height: number,
    distanceTenths: number, effort: number, lossless: number) => number;
  jxl_output: () => number;
  jxl_output_size: () => number;
  jxl_free_output: () => void;
}

export async function instantiateJxl(binary: BufferSource): Promise<EncoderExports> {
  // The Worker provides no WASI files or console descriptors.
  const badFileDescriptor = () => 8; // WASI EBADF
  const { instance } = await WebAssembly.instantiate(binary, {
    env: { emscripten_notify_memory_growth: () => {} },
    wasi_snapshot_preview1: {
      proc_exit: (code: number) => { throw new Error('JPEG XL Wasmが終了しました（コード ' + code + '）。'); },
      fd_close: badFileDescriptor,
      fd_seek: badFileDescriptor,
      fd_write: badFileDescriptor,
    },
  });
  const encoder = instance.exports as unknown as EncoderExports;
  encoder._initialize();
  if (encoder.JxlEncoderVersion() !== 13000) throw new Error('JPEG XL Wasmのバージョンが一致しません。');
  return encoder;
}

export function encodeJxlPixels(
  encoder: EncoderExports,
  { data, width, height }: Pick<ImageData, 'data' | 'width' | 'height'>,
  options: JxlOptions,
): Uint8Array<ArrayBuffer> {
  const config = effectiveJxlOptions(options);
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 ||
      width > 8192 || height > 8192 || width * height > 16_000_000 ||
      !(data instanceof Uint8ClampedArray) || data.byteLength !== width * height * 4) {
    throw new RangeError('JPEG XL入力の寸法またはRGBAデータが不正です。');
  }
  const input = encoder.malloc(data.byteLength);
  if (!input) throw new Error('JPEG XL Wasmの入力メモリを確保できませんでした。');
  try {
    new Uint8Array(encoder.memory.buffer, input, data.byteLength).set(data);
    const result = encoder.jxl_encode(input, data.byteLength, width, height, config.distanceTenths,
      config.effort, Number(config.lossless));
    if (result === -2) throw new Error('JPEG XL Wasmの符号化メモリを確保できませんでした。');
    if (result !== 0) throw new Error('JPEG XLへ変換できませんでした（コード ' + result + '）。');
    const output = encoder.jxl_output();
    const length = encoder.jxl_output_size();
    // Encoding can grow memory. The returned bytes must outlive both Wasm allocations.
    const buffer = encoder.memory.buffer;
    if (output <= 0 || length <= 0 || output + length > buffer.byteLength) {
      throw new Error('JPEG XLエンコーダーの出力領域が不正です。');
    }
    const bytes = new Uint8Array(buffer, output, length);
    if (!isJxl(bytes)) throw new Error('JPEG XLエンコーダーから妥当な画像を取得できませんでした。');
    return bytes.slice();
  } finally {
    encoder.jxl_free_output();
    encoder.free(input);
  }
}
