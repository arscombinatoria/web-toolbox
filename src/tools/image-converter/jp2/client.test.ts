// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { decodeJp2, encodeJp2 } from './client';
import type { Jp2Request } from './worker';

class Bitmap {
  close = vi.fn();
  readonly width: number;
  readonly height: number;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
  }
}

function setup() {
  const workers: FakeWorker[] = [];
  class FakeWorker {
    postMessage = vi.fn<(request: Jp2Request, transfer: Transferable[]) => void>();
    terminate = vi.fn();
    onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
    onerror: (() => void) | null = null;
    onmessageerror: (() => void) | null = null;

    constructor() { workers.push(this); }
    reply(data: unknown) { this.onmessage?.(new MessageEvent('message', { data })); }
  }
  vi.stubGlobal('Worker', FakeWorker);
  vi.stubGlobal('ImageBitmap', Bitmap);
  const copy = new Bitmap(8, 8);
  vi.stubGlobal('createImageBitmap', vi.fn(async () => copy));
  const source = new Bitmap(8, 8);
  return { source: source as unknown as ImageBitmap, copy, workers };
}

const header = Uint8Array.of(
  0, 0, 0, 12, 0x6a, 0x50, 0x20, 0x20, 13, 10, 0x87, 10,
  0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x6a, 0x70, 0x32, 0x20,
  0, 0, 0, 0, 0x6a, 0x70, 0x32, 0x20,
);
const settings = { mode: 'psnr', value: 40 } as const;

afterEach(() => vi.unstubAllGlobals());

it('transfers a clone and returns the encoded bytes and decoded bitmap to the caller', async () => {
  const { source, copy, workers } = setup();
  const onStart = vi.fn();
  const result = encodeJp2(source, settings, new AbortController().signal, onStart);
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  const worker = workers[0]!;
  expect(onStart).toHaveBeenCalledOnce();
  expect(worker.postMessage).toHaveBeenCalledWith({ kind: 'encode', bitmap: copy, settings }, [copy]);
  const decoded = new Bitmap(8, 8);
  worker.reply({ kind: 'encode', bytes: header.buffer, bitmap: decoded });
  const { blob, bitmap } = await result;
  expect(blob.type).toBe('image/jp2');
  expect(new Uint8Array(await blob.arrayBuffer())).toEqual(header);
  expect(bitmap).toBe(decoded);
  expect(decoded.close).not.toHaveBeenCalled();
  expect(copy.close).toHaveBeenCalledOnce();
  expect(source.close).not.toHaveBeenCalled();
  expect(worker.terminate).toHaveBeenCalledOnce();
});

it('cancels the running Worker and rejects invalid replies and message errors', async () => {
  const { source, workers } = setup();
  const controller = new AbortController();
  const running = encodeJp2(source, settings, controller.signal, () => {});
  await vi.waitFor(() => expect(workers).toHaveLength(1));
  const aborted = expect(running).rejects.toMatchObject({ name: 'AbortError' });
  controller.abort();
  await aborted;
  expect(workers[0]!.terminate).toHaveBeenCalledOnce();

  const bad = encodeJp2(source, settings, new AbortController().signal, () => {});
  await vi.waitFor(() => expect(workers).toHaveLength(2));
  const wrongDimensions = new Bitmap(9, 8);
  const rejected = expect(bad).rejects.toThrow('変換結果');
  workers[1]!.reply({ kind: 'encode', bytes: header.buffer, bitmap: wrongDimensions });
  await rejected;
  expect(wrongDimensions.close).toHaveBeenCalledOnce();
  expect(workers[1]!.terminate).toHaveBeenCalledOnce();

  const decoding = decodeJp2(new Blob([header]), new AbortController().signal);
  await vi.waitFor(() => expect(workers).toHaveLength(3));
  const [request, transfer] = workers[2]!.postMessage.mock.calls[0]!;
  expect(request.kind).toBe('decode');
  if (request.kind === 'decode') expect(transfer).toEqual([request.bytes]);
  const crashed = expect(decoding).rejects.toThrow('Workerを実行できませんでした');
  workers[2]!.onmessageerror?.();
  await crashed;
  expect(workers[2]!.terminate).toHaveBeenCalledOnce();
});
