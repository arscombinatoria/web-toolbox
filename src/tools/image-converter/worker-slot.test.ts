// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { runHeavyWorker } from './worker-slot';

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

afterEach(() => vi.unstubAllGlobals());

it('serializes workers without Web Locks and an aborted queue entry cannot block later work', async () => {
  vi.stubGlobal('navigator', {});
  const firstGate = deferred();
  const events: string[] = [];
  const first = runHeavyWorker(new AbortController().signal, async () => {
    events.push('first-start');
    await firstGate.promise;
    events.push('first-end');
  });
  await Promise.resolve();
  await Promise.resolve();

  const canceled = new AbortController();
  const second = runHeavyWorker(canceled.signal, async () => { events.push('second-start'); });
  const third = runHeavyWorker(new AbortController().signal, async () => { events.push('third-start'); });
  canceled.abort(new DOMException('Aborted', 'AbortError'));
  await expect(second).rejects.toMatchObject({ name: 'AbortError' });
  expect(events).toEqual(['first-start']);
  firstGate.resolve();
  await Promise.all([first, third]);
  expect(events).toEqual(['first-start', 'first-end', 'third-start']);
});

it('waits abortably for the shared browser lock before starting a worker', async () => {
  const release = deferred();
  const request = vi.fn((_name: string, options: { signal: AbortSignal }, callback: () => Promise<void>) =>
    new Promise<void>((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(options.signal.reason), { once: true });
      release.promise.then(() => {
        if (!options.signal.aborted) void callback().then(resolve, reject);
      });
    }));
  vi.stubGlobal('navigator', { locks: { request } });
  const controller = new AbortController();
  const run = vi.fn(async () => 'done');
  const pending = runHeavyWorker(controller.signal, run);
  await Promise.resolve();
  await Promise.resolve();
  expect(run).not.toHaveBeenCalled();
  controller.abort(new DOMException('Aborted', 'AbortError'));
  await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  release.resolve();
  expect(run).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledOnce();
});
