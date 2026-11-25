import { afterEach, expect, it, vi } from 'vitest';
import { createMatchRunner } from './match-runner';
import { MATCH_TIMEOUT_MS, type MatchRequest, type MatchResponse, type MatchResult } from './match-protocol';

class FakeWorker {
  static instances: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<MatchResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  request!: MatchRequest;
  terminate = vi.fn();
  constructor() { FakeWorker.instances.push(this); }
  postMessage(request: MatchRequest) { this.request = request; }
  finish(result: MatchResponse = { id: this.request.id, ok: true, matches: [], incomplete: false }) { this.onmessage?.(new MessageEvent('message', { data: result })); }
}

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('checks limits before startup, times out and terminates, then recovers on rerun', () => {
  vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  const received: MatchResult[] = []; const runner = createMatchRunner(result => received.push(result));
  runner.start('a'.repeat(4096), '', 'x'.repeat(32_768));
  expect(FakeWorker.instances).toHaveLength(1);
  FakeWorker.instances[0]!.finish({ id: FakeWorker.instances[0]!.request.id, ok: true, matches: [], incomplete: false });
  runner.start('a'.repeat(4097), '', 'x');
  expect(FakeWorker.instances).toHaveLength(1); expect(received.at(-1)).toMatchObject({ kind: 'limit' });
  runner.start('x', '', 'y'.repeat(32_769));
  expect(FakeWorker.instances).toHaveLength(1); expect(received.at(-1)).toMatchObject({ kind: 'limit' });
  runner.start('(', '', 'x'); const timed = FakeWorker.instances[1]!;
  vi.advanceTimersByTime(MATCH_TIMEOUT_MS);
  expect(received.at(-1)).toMatchObject({ kind: 'timeout' }); expect(timed.terminate).toHaveBeenCalledOnce();
  runner.start('x', 'g', 'xx'); const current = FakeWorker.instances[2]!;
  current.finish({ id: current.request.id, ok: true, matches: [], incomplete: false });
  expect(received.at(-1)).toMatchObject({ ok: true }); expect(current.terminate).toHaveBeenCalledOnce();
  runner.dispose();
});

it('reports Worker constructor failure and allows a later retry', () => {
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', class { constructor() { throw new Error('blocked'); } });
  const received: MatchResult[] = []; const runner = createMatchRunner(result => received.push(result));
  runner.start('x', '', 'x');
  expect(received[0]).toMatchObject({ ok: false, kind: 'worker' });
  vi.stubGlobal('Worker', FakeWorker);
  runner.start('x', '', 'x');
  const worker = FakeWorker.instances[0]!;
  worker.finish({ id: worker.request.id, ok: true, matches: [], incomplete: false });
  expect(received.at(-1)).toMatchObject({ ok: true });
  runner.dispose();
});

it('ignores stale ids and late messages after cancel, rerun, and disposal', () => {
  vi.useFakeTimers(); FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  const received: MatchResult[] = []; const runner = createMatchRunner(result => received.push(result));
  runner.start('x', '', 'x'); const old = FakeWorker.instances[0]!;
  runner.cancel();
  runner.start('y', '', 'y'); const active = FakeWorker.instances[1]!;
  old.finish({ id: old.request.id, ok: true, matches: [], incomplete: false });
  active.finish({ id: -1, ok: true, matches: [], incomplete: false });
  expect(received).toHaveLength(0);
  active.finish({ id: active.request.id, ok: true, matches: [], incomplete: false });
  expect(received).toHaveLength(1);
  runner.start('z', '', 'z'); const disposed = FakeWorker.instances[2]!; const queued = disposed.onmessage;
  runner.dispose(); queued?.(new MessageEvent('message', { data: { id: disposed.request.id, ok: true, matches: [], incomplete: false } }));
  expect(received).toHaveLength(1); expect(disposed.terminate).toHaveBeenCalledOnce();
});

it('turns Worker errors into a visible result and prevents default error logging', () => {
  FakeWorker.instances = []; vi.stubGlobal('Worker', FakeWorker);
  const received: MatchResult[] = []; const runner = createMatchRunner(result => received.push(result));
  runner.start('x', '', 'x'); const worker = FakeWorker.instances[0]!;
  const preventDefault = vi.fn(); worker.onerror?.({ preventDefault } as unknown as ErrorEvent);
  expect(preventDefault).toHaveBeenCalledOnce(); expect(received[0]).toMatchObject({ ok: false, kind: 'worker' });
  runner.dispose();
});
