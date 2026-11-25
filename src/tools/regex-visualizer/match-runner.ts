import { MAX_PATTERN_LENGTH } from './protocol';
import { MATCH_TIMEOUT_MS, MAX_TEST_LENGTH, type MatchRequest, type MatchResponse, type MatchResult } from './match-protocol';

export function createMatchRunner(receive: (result: MatchResult) => void) {
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
    start(pattern: string, flags: string, input: string) {
      cancel();
      if (disposed) return;
      if (pattern.length > MAX_PATTERN_LENGTH || input.length > MAX_TEST_LENGTH) {
        receive({ ok: false, kind: 'limit', message: `パターンは${MAX_PATTERN_LENGTH.toLocaleString('en-US')}、テスト文字列は${MAX_TEST_LENGTH.toLocaleString('en-US')} UTF-16コード単位以内にしてください。` }); return;
      }
      const id = generation;
      let deadline = 0;
      const finish = (result: MatchResult) => {
        if (disposed || id !== generation) return;
        if (performance.now() >= deadline) result = { ok: false, kind: 'timeout', message: 'マッチ確認が2秒を超えたため中断しました。正規表現を見直してください。' };
        cancel();
        receive(result);
      };
      try {
        deadline = performance.now() + MATCH_TIMEOUT_MS;
        worker = new Worker(new URL('./match-worker.ts', import.meta.url), { type: 'module' });
        worker.onmessage = (event: MessageEvent<MatchResponse>) => { if (event.data.id === id) finish(event.data); };
        worker.onerror = (event) => { event.preventDefault(); finish({ ok: false, kind: 'worker', message: 'マッチ確認Workerで処理できませんでした。入力を変更するか再試行してください。' }); };
        worker.onmessageerror = () => finish({ ok: false, kind: 'worker', message: 'マッチ確認Workerの結果を読み取れませんでした。' });
        timer = setTimeout(() => finish({ ok: false, kind: 'timeout', message: 'マッチ確認が2秒を超えたため中断しました。正規表現を見直してください。' }), Math.max(0, deadline - performance.now()));
        worker.postMessage({ id, pattern, flags, input } satisfies MatchRequest);
      } catch {
        finish({ ok: false, kind: 'worker', message: 'マッチ確認Workerを起動できませんでした。ブラウザの設定を確認してください。' });
      }
    },
    dispose() { disposed = true; cancel(); },
  };
}
