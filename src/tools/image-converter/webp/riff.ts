export function isWebp(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 20) return false;
  const tag = (offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return tag(0) === 'RIFF' && tag(8) === 'WEBP' && view.getUint32(4, true) === bytes.byteLength - 8 &&
    ['VP8 ', 'VP8L', 'VP8X'].includes(tag(12)) &&
    view.getUint32(16, true) <= bytes.byteLength - 20;
}
