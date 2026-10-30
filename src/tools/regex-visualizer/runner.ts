import { MAX_PATTERN_LENGTH, WORKER_TIMEOUT_MS, type DiagramRequest, type DiagramResponse, type DiagramResult } from './protocol';

export function createRunner(receive: (result: DiagramResult) => void) {
  let worker: Worker | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let generation = 0;
  let disposed = false;
  const cancel = () => {
    generation++;
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
    if (worker) { worker.onmessage = null; worker.onerror = null; worker.onmessageerror = null; worker.terminate(); }
    worker = undefined;
  };
  return {
    cancel,
    start(pattern: string, flags: string) {
      cancel();
      if (disposed) return;
      if (pattern.length > MAX_PATTERN_LENGTH) {
        receive({ ok: false, kind: 'limit', message: `入力は${MAX_PATTERN_LENGTH.toLocaleString('en-US')} UTF-16コード単位以内にしてください。` });
        return;
      }
      const id = generation;
      const finish = (result: DiagramResult) => {
        if (disposed || id !== generation) return;
        cancel();
        receive(result);
      };
      try {
        worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<DiagramResponse>) => {
          if (event.data.id === id) finish(event.data);
        };
        worker.onerror = (event) => {
          event.preventDefault();
          finish({ ok: false, kind: 'render', message: 'Workerで解析・描画できませんでした。入力を変更するか再読み込みしてください。' });
        };
        worker.onmessageerror = () => finish({ ok: false, kind: 'render', message: 'Workerの結果を読み取れませんでした。' });
        timer = setTimeout(() => finish({ ok: false, kind: 'limit', message: '解析・描画が4秒を超えたため中断しました。式を分割してください。' }), WORKER_TIMEOUT_MS);
        worker.postMessage({ id, pattern, flags } satisfies DiagramRequest);
      } catch {
        finish({ ok: false, kind: 'render', message: 'Workerを起動できませんでした。ブラウザの設定を確認して再読み込みしてください。' });
      }
    },
    dispose() { disposed = true; cancel(); },
  };
}
