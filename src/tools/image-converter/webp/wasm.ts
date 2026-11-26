import { effectiveWebpOptions, type WebpOptions } from './options';

interface EncoderExports {
  memory: WebAssembly.Memory;
  _initialize: () => void;
  WebPGetEncoderVersion: () => number;
  malloc: (length: number) => number;
  free: (pointer: number) => void;
  encode_webp: (pointer: number, width: number, height: number, lossless: number, quality: number,
    alphaQuality: number, method: number, sharpYuv: number, exact: number, nearLossless: number) => number;
  webp_output: () => number;
  clear_webp_output: () => void;
}

export async function instantiateWebp(binary: BufferSource): Promise<EncoderExports> {
  const { instance } = await WebAssembly.instantiate(binary, {
    // All views are created from the current buffer after calls that can grow memory.
    env: { emscripten_notify_memory_growth: () => {} },
  });
  const encoder = instance.exports as unknown as EncoderExports;
  encoder._initialize();
  if (encoder.WebPGetEncoderVersion() !== 0x010600) throw new Error('WebP Wasmのバージョンが一致しません。');
  return encoder;
}

export function encodeWebpPixels(encoder: EncoderExports, pixels: ImageData, options: WebpOptions): Uint8Array<ArrayBuffer> {
  const { data, width, height } = pixels;
  const input = encoder.malloc(data.byteLength);
  if (!input) throw new Error('WebP Wasmの入力メモリを確保できませんでした。');
  const config = effectiveWebpOptions(options);
  try {
    new Uint8Array(encoder.memory.buffer, input, data.byteLength).set(data);
    const length = encoder.encode_webp(input, width, height, config.lossless, config.quality, config.alpha_quality,
      config.method, config.use_sharp_yuv, config.exact, config.near_lossless);
    const output = encoder.webp_output();
    if (length <= 0 || !output) throw new Error('WebPへ変換できませんでした。');
    // Read the current memory buffer as the encoder may have grown it.
    return new Uint8Array(encoder.memory.buffer, output, length).slice();
  } finally {
    encoder.clear_webp_output();
    encoder.free(input);
  }
}
