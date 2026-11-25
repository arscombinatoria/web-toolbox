import { drawOnWhite } from './paint';

export const encoders = {
  original: { label: 'Original', type: null, extension: '', hasQuality: false },
  'image/jpeg': { label: 'Browser JPEG', type: 'image/jpeg', extension: '.jpg', hasQuality: true },
  'image/png': { label: 'Browser PNG', type: 'image/png', extension: '.png', hasQuality: false },
  oxipng: { label: 'Oxipng', type: 'image/png', extension: '.png', hasQuality: false },
} as const;

export type EncoderId = keyof typeof encoders;
type OutputType = NonNullable<(typeof encoders)[EncoderId]['type']>;

export function formatFileSize(bytes: number): string {
  if (bytes < 1_000) return bytes.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' B';
  if (bytes < 1_000_000) {
    return (bytes / 1_000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' KB';
  }
  return (bytes / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' MB';
}

function inputType(bytes: Uint8Array): string | undefined {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => byte === bytes[i])) return 'image/png';
  const tag = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'image/webp';
}

export async function decode(file: File, signal: AbortSignal): Promise<ImageBitmap> {
  if (file.size > 32 * 1024 * 1024) throw new Error('32 MiB以下の画像を選択してください。');
  const type = inputType(new Uint8Array(await file.slice(0, 12).arrayBuffer()));
  if (!type || (file.type && file.type !== type)) {
    throw new Error('JPEG・PNG・WebPの画像を選択してください。');
  }
  signal.throwIfAborted();
  const image = new Image();
  image.decoding = 'async';
  const url = URL.createObjectURL(file);
  let abort: (() => void) | undefined;
  try {
    // 寸法が分かるまで明示的な画素デコードとCanvas確保を待つ。
    await new Promise<void>((resolve, reject) => {
      abort = () => reject(signal.reason);
      signal.addEventListener('abort', abort, { once: true });
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('画像を読み込めませんでした。ファイルの破損を確認してください。'));
      image.src = url;
    });
    signal.throwIfAborted();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (width > 8192 || height > 8192 || width * height > 16_000_000) {
      throw new Error('画像は各辺8,192px以下、1,600万画素以下にしてください。');
    }
    try {
      return await createImageBitmap(image);
    } catch {
      throw new Error('画像を読み込めませんでした。ファイルの破損や画像サイズを確認してください。');
    }
  } finally {
    if (abort) signal.removeEventListener('abort', abort);
    image.onload = image.onerror = null;
    image.removeAttribute('src');
    URL.revokeObjectURL(url);
  }
}

export async function encode(image: ImageBitmap, type: OutputType, quality: number): Promise<Blob> {
  const canvas = document.createElement('canvas');
  try {
    canvas.width = image.width;
    canvas.height = image.height;
    const context = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!context) throw new Error();
    if (type === 'image/jpeg') drawOnWhite(context, image);
    else context.drawImage(image, 0, 0);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, type, type === 'image/jpeg' ? quality : undefined);
    });
    if (!blob?.size || blob.type !== type) throw new Error();
    return blob;
  } catch {
    throw new Error('指定形式に変換できませんでした。画像サイズや形式を確認してください。');
  } finally {
    canvas.width = canvas.height = 0;
  }
}

export function sizeChange(before: number, after: number): string {
  if (!before) return '—';
  const percent = (after - before) / before * 100;
  const sign = percent > 0 ? '+' : percent < 0 ? '-' : '';
  return sign + Math.abs(percent).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + '%';
}
