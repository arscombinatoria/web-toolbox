// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { encodeOxipng } from './client';
import { defaultOxipngOptions } from './options';

class MockWorker {
  static instances: MockWorker[] = [];
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onerror: (() => void) | null = null;
  onmessageerror: (() => void) | null = null;
  postMessage = vi.fn();
  terminate = vi.fn();
  readonly url: URL;
  readonly options: WorkerOptions;
  constructor(url: URL, options: WorkerOptions) { this.url = url; this.options = options; MockWorker.instances.push(this); }
  reply(data: unknown) { this.onmessage?.({ data } as MessageEvent<unknown>); }
}

const source = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;
const copy = { width: 2, height: 2, close: vi.fn() } as unknown as ImageBitmap;

afterEach(() => {
  MockWorker.instances = [];
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup() {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(copy));
  return encodeOxipng(source, { ...defaultOxipngOptions }, new AbortController().signal, vi.fn());
}

it('clones the decoded bitmap, transfers it to a module Worker, receives PNG bytes and terminates', async () => {
  const pending = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  expect(worker.options.type).toBe('module');
  expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ options: defaultOxipngOptions }), [copy]);
  const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]).buffer;
  worker.reply({ bytes });
  const blob = await pending;
  expect(blob.type).toBe('image/png');
  expect(await blob.arrayBuffer()).toEqual(bytes);
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});

it('terminates and releases the transferred bitmap on a worker error', async () => {
  const pending = setup();
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  worker.onerror?.();
  await expect(pending).rejects.toThrow('Worker');
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});

it('aborting a running request terminates the worker and rejects the result', async () => {
  vi.stubGlobal('Worker', MockWorker);
  vi.stubGlobal('createImageBitmap', vi.fn().mockResolvedValue(copy));
  const controller = new AbortController();
  const pending = encodeOxipng(source, { ...defaultOxipngOptions }, controller.signal, vi.fn());
  await vi.waitFor(() => expect(MockWorker.instances).toHaveLength(1));
  const worker = MockWorker.instances[0]!;
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  expect(worker.terminate).toHaveBeenCalledOnce();
  expect(copy.close).toHaveBeenCalledOnce();
});
