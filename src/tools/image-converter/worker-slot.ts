export const imageWorkerLockName = 'web-toolbox:image-converter:heavy-worker';

let queueTail: Promise<void> = Promise.resolve();

function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(value => { signal.removeEventListener('abort', abort); resolve(value); }, error => {
      signal.removeEventListener('abort', abort);
      reject(error);
    });
  });
}

export async function runHeavyWorker<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
  signal.throwIfAborted();
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  const previous = queueTail;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  queueTail = previous.then(() => gate);
  try {
    await abortable(previous, signal);
    signal.throwIfAborted();
    if (locks) {
      // Workers hold this same lock until terminate() reclaims their Wasm state.
      await locks.request(imageWorkerLockName, { signal }, () => {});
      signal.throwIfAborted();
    }
    return await run();
  } finally {
    release();
  }
}
