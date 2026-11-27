// Verify the frame and scan headers and walk the entropy data through EOI.
export function validateJpeg(bytes: Uint8Array, width: number, height: number, sampling: number, frameMarker: number,
  validScan: (header: Uint8Array, index: number) => boolean, validScanCount: (count: number) => boolean): boolean {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return false;
  const read16 = (offset: number) => bytes[offset]! * 256 + bytes[offset + 1]!;
  let offset = 2;
  let frame = false;
  let quantizationTables = false;
  let huffmanTables = false;
  let scans = 0;
  while (offset < bytes.length) {
    if (bytes[offset++] !== 0xff) return false;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === undefined) return false;
    if (marker === 0xd9) {
      return frame && validScanCount(scans) && offset === bytes.length;
    }
    if (offset + 2 > bytes.length) return false;
    const length = read16(offset);
    const end = offset + length;
    if (length < 2 || end > bytes.length) return false;
    if (marker === 0xc0 || marker === 0xc2) {
      if (frame || scans || marker !== frameMarker || length !== 17 ||
          bytes[offset + 2] !== 8 || read16(offset + 3) !== height || read16(offset + 5) !== width ||
          bytes[offset + 7] !== 3 || bytes[offset + 9] !== sampling ||
          bytes[offset + 12] !== 0x11 || bytes[offset + 15] !== 0x11) return false;
      frame = true;
    } else if (marker === 0xdb) {
      if (length < 67) return false;
      quantizationTables = true;
    } else if (marker === 0xc4) {
      if (length < 20) return false;
      huffmanTables = true;
    } else if (marker === 0xda) {
      const components = bytes[offset + 2] ?? 0;
      if (!frame || !quantizationTables || !huffmanTables || components < 1 || components > 3 ||
          length !== 6 + 2 * components) return false;
      if (!validScan(bytes.subarray(offset + 2, end), scans)) return false;
      scans++;
      offset = end;
      while (offset < bytes.length) {
        const markerStart = bytes.indexOf(0xff, offset);
        if (markerStart === -1) return false;
        let next = markerStart + 1;
        while (bytes[next] === 0xff) next++;
        const code = bytes[next];
        if (code === undefined) return false;
        if (code !== 0 && !(code >= 0xd0 && code <= 0xd7)) {
          offset = markerStart;
          break;
        }
        offset = next + 1;
      }
      if (offset === end) return false;
      continue;
    } else if (marker !== 0xdd && marker !== 0xfe && !(marker >= 0xe0 && marker <= 0xef)) {
      return false;
    }
    offset = end;
  }
  return false;
}
