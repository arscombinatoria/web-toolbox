// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { encodeAvif } from './client';
import { defaultAvifOptions } from './options';

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
const bytes = new Uint8Array([0, 0, 0, 16, 102, 116, 121, 112, 97, 118, 105, 102, 0, 0, 0, 0]).buffer;

afterEach(() => {
  MockWorker.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(controller = new AbortController()) {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(copy));
  const onStart = vi.fn();
  return { pending: encodeAvif(source, { ...defaultAvifOptions }, controller.signal, onStart), controller, onStart };
}

it('clones the source before transfer, signals Worker start, returns an AVIF Blob and terminates', async () => {
  const { pending, onStart } = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  expect(worker.options.type).toBe('module');
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ options: defaultAvifOptions }), [copy]);
  expect(onStart).toHaveBeenCalledOnce();
  worker.reply({ bytes });
  const blob = await pending;
  expect(blob.type).toBe('image/avif');
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
  const pending = encodeAvif(source, { ...defaultAvifOptions }, controller.signal, vi.fn());
  await vi.waitFor(() => expect(finishCopy).toBeTypeOf('function'));
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  finishCopy(copy);
  await vi.waitFor(() => expect(copy.close).toHaveBeenCalledOnce());
  expect(MockWorker.instances).toHaveLength(0);
});
