// 2 × 2 lossy sRGB JPEG XL with alpha, generated from four synthetic RGBA pixels.
const probe = '/woIELATAEyAKAC4AbWfIAAAFSqjjBu8nOv58kOHxbSN6wxttW1hCWOzPRcKBgkJh+C8qPLxwf/69OPfPCV626OaCVUhBRKstlVjGaPYWm3+nwLb+xxqyNjIp2lUps7VZ842VO7Wo61MTHjrhDyvUYhTve+Z03hjg1QD';

export interface JxlSupport {
  preview: boolean;
  input: boolean;
}

export function jxlProbeBlob(): Blob {
  return new Blob([Uint8Array.from(atob(probe), char => char.charCodeAt(0))], { type: 'image/jxl' });
}

export async function detectJxlSupport(): Promise<JxlSupport> {
  const image = new Image();
  let url: string | undefined;
  let preview = false;
  try {
    url = URL.createObjectURL(jxlProbeBlob());
    image.src = url;
    await image.decode();
    preview = image.naturalWidth === 2 && image.naturalHeight === 2;
    if (preview) {
      const bitmap = await createImageBitmap(image);
      try {
        return { preview, input: bitmap.width === 2 && bitmap.height === 2 };
      } finally {
        bitmap.close();
      }
    }
  } catch {
    // A browser can display JPEG XL without supporting ImageBitmap input.
  } finally {
    image.removeAttribute('src');
    if (url) URL.revokeObjectURL(url);
  }
  return { preview, input: false };
}
