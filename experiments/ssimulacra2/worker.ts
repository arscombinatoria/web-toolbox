import { checkDimensions, loadScorer, scoreImages } from './adapter';
import photoUrl from './assets/astronaut.png?url';

const worker = self as DedicatedWorkerGlobalScope;
const qualities = { jpeg95: 0.95, jpeg75: 0.75, jpeg30: 0.30 } as const;
export interface Request {
  fixture: string;
  width: number;
  height: number;
  conversion: string;
  repetitions?: number;
  exportRgb?: boolean;
}

function canvas2d(width: number, height: number, read = false) {
  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d', { colorSpace: 'srgb', willReadFrequently: read });
  if (!context) throw new Error('sRGB Canvas 2D を作成できませんでした。');
  return { canvas, context };
}

async function drawSource(context: OffscreenCanvasRenderingContext2D, request: Request) {
  const { fixture, width, height } = request;
  switch (fixture) {
    case 'photo': {
      const response = await fetch(photoUrl);
      if (!response.ok) throw new Error(`写真 HTTP ${response.status}`);
      const photo = await createImageBitmap(await response.blob());
      try {
        context.drawImage(photo, 0, 0, width, height);
      } finally {
        photo.close();
      }
      break;
    }
    case 'solid':
      context.fillStyle = '#2c78ad';
      context.fillRect(0, 0, width, height);
      break;
    case 'alpha':
    case 'gradient': {
      const gradient = context.createLinearGradient(0, 0, width, height);
      gradient.addColorStop(0, fixture === 'alpha' ? '#ff620000' : '#ff6200');
      gradient.addColorStop(0.5, fixture === 'alpha' ? '#2693cb80' : '#2693cb');
      gradient.addColorStop(1, '#241e47');
      context.fillStyle = gradient;
      context.fillRect(0, 0, width, height);
      break;
    }
    default:
      throw new Error('画像の種類が不正です。');
  }
}

function readOnWhite(
  context: OffscreenCanvasRenderingContext2D, source: OffscreenCanvas | ImageBitmap,
  width: number, height: number,
) {
  context.fillStyle = '#fff';
  context.fillRect(0, 0, width, height);
  context.drawImage(source, 0, 0);
  return context.getImageData(0, 0, width, height, { colorSpace: 'srgb' });
}

async function prepareImages(request: Request) {
  const { width, height, conversion } = request;
  const source = canvas2d(width, height);
  const matte = canvas2d(width, height, true);
  try {
    const start = performance.now();
    await drawSource(source.context, request);
    const drawn = performance.now();
    const reference = readOnWhite(matte.context, source.canvas, width, height);
    const read = performance.now();
    if (conversion === 'identity') {
      return {
        reference, distorted: reference, fileBytes: 0,
        sourceMs: drawn - start, encodeMs: 0, decodeMs: 0, readbackMs: read - drawn,
      };
    }

    const isPng = conversion === 'png';
    if (!isPng && !Object.hasOwn(qualities, conversion)) throw new Error('変換形式が不正です。');
    const type = isPng ? 'image/png' : 'image/jpeg';
    const quality = isPng ? undefined : qualities[conversion as keyof typeof qualities];
    const output = await (isPng ? source.canvas : matte.canvas).convertToBlob({ type, quality });
    if (!output.size || output.type !== type) throw new Error('指定形式への画像変換に失敗しました。');
    const encoded = performance.now();
    const decoded = await createImageBitmap(output);
    const decodedAt = performance.now();
    try {
      if (decoded.width !== width || decoded.height !== height) throw new Error('変換後の画像寸法が変わりました。');
      const distorted = readOnWhite(matte.context, decoded, width, height);
      return {
        reference, distorted, fileBytes: output.size,
        sourceMs: drawn - start, encodeMs: encoded - read, decodeMs: decodedAt - encoded,
        readbackMs: (read - drawn) + (performance.now() - decodedAt),
      };
    } finally {
      decoded.close();
    }
  } finally {
    source.canvas.width = source.canvas.height = 0;
    matte.canvas.width = matte.canvas.height = 0;
  }
}

async function run(request: Request) {
  checkDimensions(request.width, request.height);
  const repetitions = request.repetitions ?? 2;
  if (!Number.isInteger(repetitions) || repetitions < 1 || repetitions > 4) {
    throw new RangeError('反復回数は1〜4にしてください。');
  }
  if (request.exportRgb && request.width * request.height > 512 * 512) {
    throw new RangeError('RGBの書き出しは512×512画素相当までです。');
  }
  const { abi, load } = await loadScorer();
  const { reference, distorted, ...preparation } = await prepareImages(request);
  worker.postMessage({ phase: 'scoring' } satisfies Reply);
  const samples = [];
  let ppm: ArrayBuffer[] | undefined;
  for (let index = 0; index < repetitions; index++) {
    const { ppm: pair, ...sample } = scoreImages(abi, reference, distorted, Boolean(request.exportRgb && index === 0));
    ppm ??= pair;
    samples.push(sample);
  }
  return { load, preparation, samples, ppm };
}

export type Result = Awaited<ReturnType<typeof run>>;
export type Reply = { result: Result } | { error: string } | { phase: 'scoring' };

worker.addEventListener('message', async (event: MessageEvent<Request>) => {
  try {
    const result = await run(event.data);
    worker.postMessage({ result } satisfies Reply, result.ppm ?? []);
  } catch (error) {
    worker.postMessage({ error: error instanceof Error ? error.message : String(error) } satisfies Reply);
  }
}, { once: true });
