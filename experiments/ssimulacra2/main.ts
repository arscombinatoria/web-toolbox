import type { Reply, Request, Result } from './worker';

function measure(request: Request, signal: AbortSignal, onScoring?: () => void): Promise<Result> {
  signal.throwIfAborted();
  const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  let abort: (() => void) | undefined;
  return new Promise<Result>((resolve, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      if ('phase' in data) onScoring?.();
      else if ('error' in data) reject(new Error(data.error));
      else resolve(data.result);
    };
    worker.onerror = (event) => reject(new Error(event.message || 'Workerを実行できませんでした。'));
    worker.onmessageerror = () => reject(new Error('Workerの結果を読み取れませんでした。'));
    worker.postMessage(request);
  }).finally(() => {
    if (abort) signal.removeEventListener('abort', abort);
    worker.terminate();
  });
}

// Playwright uses this entry point for exact-pixel reference exports and failure cases.
declare global {
  interface Window { measureSsimulacra2: typeof measure }
}
window.measureSsimulacra2 = measure;

const form = document.querySelector('form')!;
const cancel = document.querySelector<HTMLButtonElement>('#cancel')!;
const submit = document.querySelector<HTMLButtonElement>('button[type="submit"]')!;
const status = document.querySelector<HTMLElement>('#status')!;
const output = document.querySelector<HTMLElement>('#result')!;
let active: AbortController | undefined;
cancel.addEventListener('click', () => active?.abort());
form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (active) return;
  const data = new FormData(form);
  const request = {
    fixture: String(data.get('fixture')),
    width: Number(data.get('width')),
    height: Number(data.get('height')),
    conversion: String(data.get('conversion')),
  };
  const controller = new AbortController();
  active = controller;
  submit.disabled = true;
  cancel.disabled = false;
  output.hidden = true;
  status.textContent = '計測中…';
  try {
    const result = await measure(request, controller.signal, () => { status.textContent = '採点中…'; });
    const [first, second] = result.samples;
    status.textContent = `スコア ${first!.score.toFixed(4)} ／ 計算時間 初回 ${first!.scoreMs.toFixed(1)} ms・2回目 ${second!.scoreMs.toFixed(1)} ms`;
    output.textContent = JSON.stringify(result, null, 2);
    output.hidden = false;
  } catch (error) {
    status.textContent = controller.signal.aborted ? '中止しました。' :
      (error instanceof Error ? error.message : String(error));
  } finally {
    active = undefined;
    submit.disabled = false;
    cancel.disabled = true;
  }
});
