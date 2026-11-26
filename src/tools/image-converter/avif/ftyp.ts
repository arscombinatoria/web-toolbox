const tag = (bytes: Uint8Array, offset: number) => String.fromCharCode(...bytes.subarray(offset, offset + 4));

/** Validates the first ISO BMFF box and its AVIF major or compatible brands. */
export function isAvifFtyp(bytes: Uint8Array, fileSize = bytes.byteLength): boolean {
  if (tag(bytes, 4) !== 'ftyp' || bytes.length < 16) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const extended = view.getUint32(0) === 1;
  const headerSize = extended ? 16 : 8;
  const majorOffset = headerSize;
  const compatibleOffset = headerSize + 8;
  if (extended && bytes.length < compatibleOffset) return false;
  const size = extended ? view.getBigUint64(8) : BigInt(view.getUint32(0));
  if (size > BigInt(Number.MAX_SAFE_INTEGER) || size > BigInt(fileSize) || size > BigInt(bytes.length) ||
      size < BigInt(compatibleOffset) || (Number(size) - compatibleOffset) % 4 !== 0) return false;
  if (tag(bytes, majorOffset) === 'avif' || tag(bytes, majorOffset) === 'avis') return true;
  for (let offset = compatibleOffset; offset < Number(size); offset += 4) {
    const brand = tag(bytes, offset);
    if (brand === 'avif' || brand === 'avis') return true;
  }
  return false;
}
