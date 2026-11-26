// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { runHeavyWorker } from '../worker-slot';
import { encodeWebp } from './client';
import { defaultWebpOptions } from './options';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  readonly options: WorkerOptions;
  constructor(_url: URL, options: WorkerOptions) { this.options = options; MockWorker.instances.push(this); }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
}

const source = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
const copy = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
const bytes = new Uint8Array([82, 73, 70, 70, 14, 0, 0, 0, 87, 69, 66, 80, 86, 80, 56, 76, 1, 0, 0, 0, 47, 0]).buffer;

afterEach(() => {
  MockWorker.instances = [];
  vi.clearAllMocks();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(controller = new AbortController()) {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(copy));
  const onStart = vi.fn();
  return { pending: encodeWebp(source, { ...defaultWebpOptions }, controller.signal, onStart), controller, onStart };
}

it('clones the source before transfer, signals Worker start, returns an WebP Blob and terminates', async () => {
  const { pending, onStart } = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  expect(worker.options.type).toBe('module');
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ options: defaultWebpOptions }), [copy]);
  expect(onStart).toHaveBeenCalledOnce();
  worker.reply({ bytes });
  const blob = await pending;
  expect(blob.type).toBe('image/webp');
  expect(await blob.arrayBuffer()).toEqual(bytes);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});

it('terminates on a worker error and frees the copied bitmap', async () => {
  const { pending } = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  worker.onerror?.();
  await expect(pending).rejects.toThrow('Worker');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});

it('aborting an active conversion terminates the worker and rejects with AbortError', async () => {
  const { pending, controller } = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});

it('releases a copied bitmap when cancelled while cloning is still pending', async () => {
  vi.stubGlobal('Worker', MockWorker);
  let finishCopy!: (bitmap: ImageBitmap) => void;
  vi.stubGlobal('createImageBitmap', () => new Promise<ImageBitmap>(resolve => { finishCopy = resolve; }));
  const controller = new AbortController();
  const pending = encodeWebp(source, { ...defaultWebpOptions }, controller.signal, vi.fn());
  await vi.waitFor(() => expect(finishCopy).toBeTypeOf('function'));
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  finishCopy(copy);
  await vi.waitFor(() => expect(copy.close).toHaveBeenCalledOnce());
  expect(MockWorker.instances).toHaveLength(0);
});

it('rejects malformed replies, reports a WASM load failure and allows retry', async () => {
  for (const reply of [null, { bytes: new ArrayBuffer(22) }, { error: 'WebP Wasm HTTP 503' }]) {
    const { pending } = setup();
    const index = MockWorker.instances.length;
    await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(index + 1));
    const worker = MockWorker.instances[index]!;
    worker.reply(reply);
    await expect(pending).rejects.toThrow(reply && 'error' in reply ? reply.error : '応答');
    expect(worker.terminate).toHaveBeenCalledOnce();
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(worker.onmessageerror).toBeNull();
  }
  const { pending } = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(4));
  MockWorker.instances[3]!.reply({ bytes });
  await expect(pending).resolves.toMatchObject({ type: 'image/webp' });
});

it('cancels a queued WebP job before cloning or creating a Worker', async () => {
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const occupied = runHeavyWorker(new AbortController().signal, () => gate);
  try {
    const { pending, controller } = setup();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(MockWorker.instances).toHaveLength(0);
  } finally {
    release();
    await occupied;
  }
});
