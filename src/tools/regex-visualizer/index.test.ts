import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { DEBOUNCE_MS, WORKER_TIMEOUT_MS, type DiagramRequest, type DiagramResponse, type DiagramResult } from './protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<DiagramResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request!: DiagramRequest;
  terminate = vi.fn();
  postMessage(request: DiagramRequest) { this.request = request; }
  constructor() { FakeWorker.instances.push(this); }
  finish(result: DiagramResult = { ok: true, svg: '<svg xmlns="http://www.w3.org/2000/svg"/>', warnings: [] }) {
    this.onmessage?.(new MessageEvent('message', { data: { id: this.request.id, ...result } }));
  }
}
function setup() {
  vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  let counter = 0;
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:regex-${++counter}`);
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const dispose = mount(document.body);
  const input = document.querySelector<HTMLTextAreaElement>('#regex-pattern')!;
  const image = document.querySelector<HTMLImageElement>('.regex-tool img')!;
  const error = document.querySelector<HTMLElement>('[role="alert"]')!;
  const status = document.querySelector<HTMLElement>('[role="status"]')!;
  const download = document.querySelector<HTMLButtonElement>('[data-download]')!;
  const fill = (value: string) => { input.value = value; input.dispatchEvent(new Event('input')); };
  const tick = () => vi.advanceTimersByTime(DEBOUNCE_MS);
  return { dispose, input, image, error, status, download, fill, tick, create, revoke, click };
}
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });

it('デバウンス・trimなし・u/v排他・全フラグと空文字をWorkerへ渡す', () => {
  const ui = setup(); ui.fill(' a '); ui.fill(' b ');
  expect(FakeWorker.instances).toHaveLength(0); ui.tick();
  expect(FakeWorker.instances[0]!.request.pattern).toBe(' b ');
  const flags = [...document.querySelectorAll<HTMLInputElement>('.regex-flags input')];
  for (const flag of flags) flag.click();
  expect(flags.find(flag => flag.value === 'u')!.checked).toBe(false);
  expect(flags.find(flag => flag.value === 'v')!.checked).toBe(true);
  ui.tick(); expect(FakeWorker.instances.at(-1)!.request.flags).toBe('dgimsvy');
  flags.find(flag => flag.value === 'u')!.click(); ui.tick();
  expect(FakeWorker.instances.at(-1)!.request.flags).toBe('dgimsuy');
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click(); ui.tick();
  expect(FakeWorker.instances.at(-1)!.request.pattern).toBe(''); expect(document.activeElement).toBe(ui.input);
  ui.dispose();
});

it('入力時に旧図・操作・URLを即座に無効化し、古い解析・画像ロードを表示しない', () => {
  const ui = setup(); ui.tick(); FakeWorker.instances[0]!.finish();
  const staleLoad = ui.image.onload!;
  ui.image.dispatchEvent(new Event('load')); expect(ui.download.disabled).toBe(false);
  const firstUrl = ui.image.src;
  ui.fill('next');
  expect(ui.image.hidden).toBe(true); expect(ui.image.hasAttribute('src')).toBe(false);
  expect(ui.revoke).toHaveBeenCalledWith(firstUrl); expect(ui.download.disabled).toBe(true);
  staleLoad.call(ui.image, new Event('load')); expect(ui.status.textContent).toBe('解析を待っています。');
  ui.tick(); const second = FakeWorker.instances[1]!; const queued = second.onmessage!;
  ui.fill('latest'); queued(new MessageEvent('message', { data: { id: second.request.id, ok: true, svg: 'old', warnings: [] } }));
  expect(ui.image.hidden).toBe(true); ui.tick(); FakeWorker.instances[2]!.finish(); ui.image.dispatchEvent(new Event('load'));
  expect(ui.status.textContent).toBe('図を更新しました。'); ui.dispose();
});

it('構文エラー・位置と意味上の注意を分離し、エラー時は旧図を消す', () => {
  const ui = setup(); ui.tick();
  FakeWorker.instances[0]!.onmessage!(new MessageEvent('message', { data: { id: FakeWorker.instances[0]!.request.id, ok: true, svg: '<svg/>', warnings: ['0文字の条件'] } }));
  expect(document.querySelector('.regex-warnings')?.textContent).toContain('0文字の条件'); expect(ui.error.textContent).toBe('');
  ui.fill('('); ui.tick(); const worker = FakeWorker.instances[1]!;
  worker.onmessage!(new MessageEvent('message', { data: { id: worker.request.id, ok: false, kind: 'syntax', message: '<bad>', position: 1 } }));
  expect(ui.error.textContent).toContain('構文エラー：<bad>（位置 2'); expect(ui.error.querySelector('bad')).toBeNull();
  expect(ui.input.getAttribute('aria-invalid')).toBe('true'); expect(ui.image.hidden).toBe(true); expect(ui.download.disabled).toBe(true);
  ui.fill('x'); ui.tick(); vi.advanceTimersByTime(WORKER_TIMEOUT_MS);
  expect(ui.error.textContent).toContain('安全上限'); expect(ui.input.getAttribute('aria-invalid')).toBe('false'); ui.dispose();
});

it('画像・Blob URLの失敗を明示し、再入力で回復する', () => {
  const ui = setup(); ui.tick(); FakeWorker.instances[0]!.finish(); ui.image.dispatchEvent(new Event('error'));
  expect(ui.error.textContent).toContain('SVGを表示できません'); expect(ui.image.hidden).toBe(true);
  ui.fill('a'); ui.tick(); ui.create.mockImplementationOnce(() => { throw new Error('blocked'); }); FakeWorker.instances[1]!.finish();
  expect(ui.error.textContent).toContain('表示用URL'); expect(ui.download.disabled).toBe(true); ui.dispose();
});

it('別URLでSVGをダウンロードし、入力変更・タイマー・破棄で各URLを一度だけ解放', () => {
  const ui = setup(); ui.tick(); FakeWorker.instances[0]!.finish(); ui.image.dispatchEvent(new Event('load'));
  ui.download.click();
  expect(ui.create).toHaveBeenCalledTimes(2); expect(ui.click).toHaveBeenCalledOnce();
  expect(document.querySelector('a[download]')).toBeNull();
  expect(ui.create.mock.calls[0]![0]).toBe(ui.create.mock.calls[1]![0]);
  ui.fill('next'); expect(ui.revoke).toHaveBeenCalledExactlyOnceWith('blob:regex-1');
  vi.advanceTimersByTime(1000); expect(ui.revoke).toHaveBeenCalledWith('blob:regex-2');
  ui.tick(); FakeWorker.instances.at(-1)!.finish(); ui.image.dispatchEvent(new Event('load')); ui.download.click();
  ui.dispose(); ui.dispose();
  expect(ui.revoke.mock.calls.map(call => call[0]).sort()).toEqual(['blob:regex-1', 'blob:regex-2', 'blob:regex-3', 'blob:regex-4']);
  expect(vi.getTimerCount()).toBe(0);
});

it('中止・IME変換・破棄後にWorker・イベント・タイマーが画面を更新しない', () => {
  const ui = setup();
  ui.input.dispatchEvent(new CompositionEvent('compositionstart')); ui.fill('あ'); ui.tick();
  expect(FakeWorker.instances).toHaveLength(0);
  ui.input.dispatchEvent(new CompositionEvent('compositionend')); ui.tick();
  const worker = FakeWorker.instances[0]!; const queued = worker.onmessage!;
  document.querySelector<HTMLButtonElement>('[data-cancel]')!.click();
  queued(new MessageEvent('message', { data: { id: worker.request.id, ok: true, svg: 'late', warnings: [] } }));
  expect(ui.image.hidden).toBe(true); expect(ui.status.textContent).toContain('中止しました');
  ui.fill('again'); ui.tick(); const late = FakeWorker.instances[1]!.onmessage!; const id = FakeWorker.instances[1]!.request.id;
  ui.dispose(); ui.fill('after dispose'); late(new MessageEvent('message', { data: { id, ok: true, svg: 'late', warnings: [] } }));
  expect(ui.create).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0); expect(document.body.children).toHaveLength(0);
});
