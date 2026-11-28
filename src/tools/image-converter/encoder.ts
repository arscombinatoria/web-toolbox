import { drawOnWhite } from './paint';
import { isAvifFtyp } from './avif/ftyp';
import { isJxl } from './jxl/signature';
import { decodeJp2 } from './jp2/client';
import { acceptsJp2Mime, jp2FileTypeEnd, jp2InputType, jp2MimeTypes } from './jp2/signature';
import { detectJxlSupport, type JxlSupport } from './jxl/support';

export const encoders = {
  original: { label: 'Original', type: null, extension: '', hasQuality: false },
  'image/jpeg': { label: 'Browser JPEG', type: 'image/jpeg', extension: '.jpg', hasQuality: true },
  'image/png': { label: 'Browser PNG', type: 'image/png', extension: '.png', hasQuality: false },
  'image/avif': { label: 'AVIF (libaom)', type: 'image/avif', extension: '.avif', hasQuality: false },
  'image/webp': { label: 'WebP (libwebp)', type: 'image/webp', extension: '.webp', hasQuality: false },
  jpegli: { label: 'JPEG (Jpegli)', type: 'image/jpeg', extension: '.jpg', hasQuality: false },
  mozjpeg: { label: 'JPEG (MozJPEG)', type: 'image/jpeg', extension: '.jpg', hasQuality: false },
  'image/jp2': { label: 'JPEG 2000 (OpenJPEG)', type: 'image/jp2', extension: '.jp2', hasQuality: false },
  'image/jxl': { label: 'JPEG XL (libjxl)', type: 'image/jxl', extension: '.jxl', hasQuality: false },
  oxipng: { label: 'Oxipng', type: 'image/png', extension: '.png', hasQuality: false },
} as const;

export type EncoderId = keyof typeof encoders;
type OutputType = (typeof encoders)['image/jpeg' | 'image/png']['type'];

export const inputMimeTypes: readonly string[] = [
  'image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/jxl', ...jp2MimeTypes,
];
export const supportedInputMessage = 'JPEG・PNG・WebP・AVIF・JPEG XL・JPEG 2000の画像を選択してください。';

export function formatFileSize(bytes: number): string {
  if (bytes < 1_000) return bytes.toLocaleString('ja-JP', { maximumFractionDigits: 0 }) + ' B';
  if (bytes < 1_000_000) {
    return (bytes / 1_000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' KB';
  }
  return (bytes / 1_000_000).toLocaleString('ja-JP', { maximumFractionDigits: 2 }) + ' MB';
}

export function inputType(bytes: Uint8Array, fileSize = bytes.byteLength): string | undefined {
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => byte === bytes[i])) return 'image/png';
  const tag = (start: number) => String.fromCharCode(...bytes.subarray(start, start + 4));
  if (tag(0) === 'RIFF' && tag(8) === 'WEBP') return 'image/webp';
  if (isAvifFtyp(bytes, fileSize)) return 'image/avif';
  if (isJxl(bytes)) return 'image/jxl';
  return jp2InputType(bytes, fileSize);
}

export async function decode(file: File, signal: AbortSignal, jxlSupport?: Promise<JxlSupport>): Promise<ImageBitmap> {
  if (file.size > 32 * 1024 * 1024) throw new Error('32 MiB以下の画像を選択してください。');
  const header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  let type = inputType(header, file.size);
  const jp2End = jp2FileTypeEnd(header, file.size);
  if (!type && jp2End && jp2End > header.length) {
    type = jp2InputType(new Uint8Array(await file.slice(0, jp2End).arrayBuffer()), file.size);
  }
  if (!type && String.fromCharCode(...header.subarray(4, 8)) === 'ftyp') {
    const prefix = new DataView(header.buffer, header.byteOffset, header.byteLength);
    const size32 = prefix.getUint32(0);
    const extended = size32 === 1;
    const declaredSize = extended && header.length >= 16 ? Number(prefix.getBigUint64(8)) : size32;
    if (Number.isSafeInteger(declaredSize) && declaredSize <= file.size && declaredSize >= (extended ? 24 : 16)) {
      type = inputType(new Uint8Array(await file.slice(0, declaredSize).arrayBuffer()), file.size);
    }
  }
  signal.throwIfAborted();
  if (type === 'image/jp2' || type === 'image/j2k') {
    if (!acceptsJp2Mime(type, file.type)) throw new Error(supportedInputMessage);
    return decodeJp2(file, signal);
  }
  if (!type || (file.type && file.type !== type)) {
    throw new Error(supportedInputMessage);
  }
  if (type === 'image/jxl') {
    const support = await (jxlSupport ?? detectJxlSupport());
    signal.throwIfAborted();
    if (!support.input) throw new Error('このブラウザではJPEG XLの入力を利用できません。');
  }
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
