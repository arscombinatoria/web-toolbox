const signature = [0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 13, 10, 0x87, 10];
const part1 = 0x6a703220; // jp2 followed by a space
const fileType = 0x66747970; // ftyp

export type Jp2InputType = 'image/jp2' | 'image/j2k';

const mimeByFormat: Record<Jp2InputType, readonly string[]> = {
  'image/jp2': ['image/jp2', 'image/x-jp2'],
  'image/j2k': ['image/j2k', 'image/j2c', 'image/x-j2k', 'image/x-j2c'],
};
const commonMimeTypes = ['image/jpeg2000', 'image/x-jpeg2000'];
export const jp2MimeTypes = [...mimeByFormat['image/jp2'], ...mimeByFormat['image/j2k'], ...commonMimeTypes];

export function jp2FileTypeEnd(bytes: Uint8Array, fileSize: number): number | undefined {
  if (bytes.length < 20 || !signature.every((byte, i) => bytes[i] === byte)) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) !== fileType) return;
  const size32 = view.getUint32(12);
  const extended = size32 === 1;
  const header = extended ? 16 : 8;
  if (extended && bytes.length < 28) return;
  const size = extended ? Number(view.getBigUint64(20)) : size32;
  if (Number.isSafeInteger(size) && size >= header + 12 && (size - header) % 4 === 0 &&
      size <= fileSize - 12) return 12 + size;
}

export function jp2InputType(bytes: Uint8Array, fileSize = bytes.byteLength): Jp2InputType | undefined {
  // Start of codestream (SOC) followed by the image and tile size marker (SIZ).
  if (bytes[0] === 0xff && bytes[1] === 0x4f && bytes[2] === 0xff && bytes[3] === 0x51) return 'image/j2k';
  const end = jp2FileTypeEnd(bytes, fileSize);
  if (!end || end > bytes.length) return;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const brand = view.getUint32(12) === 1 ? 28 : 20;
  if (view.getUint32(brand) !== part1) return;
  for (let offset = brand + 8; offset < end; offset += 4) {
    if (view.getUint32(offset) === part1) return 'image/jp2';
  }
}

export function acceptsJp2Mime(type: Jp2InputType, mime: string): boolean {
  return mime === '' || mime === 'application/octet-stream' ||
    commonMimeTypes.includes(mime) || mimeByFormat[type].includes(mime);
}
