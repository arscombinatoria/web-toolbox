// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { runHeavyWorker } from '../worker-slot';
import { encodeJxl } from './client';
import { defaultJxlOptions } from './options';
import { jxlProbeBlob } from './support';

class MockWorker {
  static workers: MockWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { MockWorker.workers.push(this); }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent); }
}

const source = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
const copy = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;

function setup() {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(copy));
  const controller = new AbortController();
  const onStart = vi.fn();
  return { pending: encodeJxl(source, defaultJxlOptions, controller.signal, onStart), controller, onStart };
}

async function workerAt(index = 0) {
  await vi.waitFor(() => expect(MockWorker.workers[index]).toBeDefined());
  return MockWorker.workers[index]!;
}

afterEach(() => {
  MockWorker.workers = [];
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('transfers a copy, terminates on abort, and can retry with a new Worker', async () => {
  const { pending, controller, onStart } = setup();
  const worker = await workerAt();
  expect(onStart).toHaveBeenCalledOnce();
  expect(worker.postMessage).toHaveBeenCalledWith({ bitmap: copy, options: defaultJxlOptions }, [copy]);
  controller.abort();
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
  expect(source.close).not.toHaveBeenCalled();

  const retry = setup();
  const next = await workerAt(1);
  const bytes = await jxlProbeBlob().arrayBuffer();
  next.reply({ bytes });
  const blob = await retry.pending;
  expect(blob.type).toBe('image/jxl');
  expect(await blob.arrayBuffer()).toEqual(bytes);
  expect(next.terminate).toHaveBeenCalledOnce();
});

it.each([
  [{ error: 'JPEG XL Wasm HTTP 503' }, 'JPEG XL Wasm HTTP 503'],
  [{ bytes: Uint8Array.of(0xff, 0x0b).buffer }, '応答'],
])('terminates on a Worker failure or invalid JPEG XL reply', async (reply, message) => {
  const { pending } = setup();
  const worker = await workerAt();
  worker.reply(reply);
  await expect(pending).rejects.toThrow(message);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});

it('cancels a queued conversion before cloning or starting its Worker', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const occupied = runHeavyWorker(new AbortController().signal, () => gate);
  try {
    const { pending, controller, onStart } = setup();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(onStart).not.toHaveBeenCalled();
    expect(MockWorker.workers).toHaveLength(0);
  } finally {
    release();
    await occupied;
  }
});
