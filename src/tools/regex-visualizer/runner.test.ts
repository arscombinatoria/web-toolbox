import { afterEach, expect, it, vi } from 'vitest';
import { createRunner } from './runner';
import { MAX_PATTERN_LENGTH, WORKER_TIMEOUT_MS, type DiagramRequest, type DiagramResponse } from './protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<DiagramResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request!: DiagramRequest;
  terminate = vi.fn();
  postMessage = vi.fn((request: DiagramRequest) => { this.request = request; });
  constructor() { FakeWorker.instances.push(this); }
  finish() { this.onmessage?.(new MessageEvent('message', { data: { id: this.request.id, ok: true, svg: '<svg/>', warnings: [] } })); }
}
function setup() {
  vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  const receive = vi.fn();
  return { runner: createRunner(receive), receive };
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('入力更新・中断・破棄で停止し、キューにあった古い成功／失敗も無視', () => {
  const { runner, receive } = setup();
  runner.start('a', 'u'); const first = FakeWorker.instances[0]!;
  const queued = first.onmessage!; const failed = first.onerror!;
  runner.start('b', 'v');
  expect(first.terminate).toHaveBeenCalledOnce();
  queued(new MessageEvent('message', { data: { id: first.request.id, ok: true, svg: 'old', warnings: [] } }));
  failed(new ErrorEvent('error'));
  expect(receive).not.toHaveBeenCalled();
  const second = FakeWorker.instances[1]!;
  second.onmessage!(new MessageEvent('message', { data: { id: -1, ok: true, svg: '', warnings: [] } }));
  expect(receive).not.toHaveBeenCalled();
  second.finish();
  expect(receive).toHaveBeenCalledOnce(); expect(second.terminate).toHaveBeenCalledOnce();
  runner.start('c', ''); const third = FakeWorker.instances[2]!; const thirdQueued = third.onmessage!;
  runner.cancel();
  thirdQueued(new MessageEvent('message', { data: { id: third.request.id, ok: false, kind: 'syntax', message: 'old' } }));
  runner.start('d', ''); const fourth = FakeWorker.instances[3]!; const fourthQueued = fourth.onmessage!;
  runner.dispose(); fourthQueued(new MessageEvent('message', { data: { id: fourth.request.id, ok: true, svg: '', warnings: [] } }));
  runner.start('e', '');
  expect(receive).toHaveBeenCalledOnce(); expect(FakeWorker.instances).toHaveLength(4);
  expect(fourth.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
});
it('4秒で強制終了し、次の入力でWorkerを再生成する', () => {
  const { runner, receive } = setup(); runner.start('a', '');
  vi.advanceTimersByTime(WORKER_TIMEOUT_MS);
  expect(receive).toHaveBeenCalledWith(expect.objectContaining({ ok: false, kind: 'limit' }));
  expect(FakeWorker.instances[0]!.terminate).toHaveBeenCalledOnce();
  runner.start('b', ''); FakeWorker.instances[1]!.finish();
  expect(receive).toHaveBeenCalledTimes(2); expect(vi.getTimerCount()).toBe(0); runner.dispose();
});
it('巨大入力はWorkerへ渡さず、起動・通信・実行エラーを通知する', () => {
  const { runner, receive } = setup(); runner.start('a'.repeat(MAX_PATTERN_LENGTH + 1), '');
  expect(FakeWorker.instances).toHaveLength(0);
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'limit' }));
  runner.start('a', ''); FakeWorker.instances[0]!.onmessageerror!();
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'render' }));
  runner.start('a', ''); FakeWorker.instances[1]!.onerror!(new ErrorEvent('error'));
  expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'render' }));
  vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
  runner.start('a', ''); expect(receive).toHaveBeenLastCalledWith(expect.objectContaining({ kind: 'render' }));
  runner.dispose(); expect(vi.getTimerCount()).toBe(0);
});
