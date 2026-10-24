import { afterEach, expect, it, vi } from 'vitest';
import { fetchRdap } from './api';
import { network } from './__tests__/fixture';
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const signal = () => new AbortController().signal;
it.each(['8.8.8.8', '2001:4860:4860::8888'])('%sを直接fetchし独自ヘッダー・再試行を使わない', async (ip) => {
  const request = vi.fn().mockResolvedValue(new Response(JSON.stringify(network)));
  vi.stubGlobal('fetch', request);
  expect((await fetchRdap(ip, signal())).info.organizations).toContain('Example Inc');
  expect(request).toHaveBeenCalledExactlyOnceWith(`https://rdap.org/ip/${encodeURIComponent(ip)}`, {
    signal: expect.any(AbortSignal), credentials: 'omit', referrerPolicy: 'no-referrer', cache: 'no-store',
  });
});
it.each([[404, 'not-found'], [429, 'rate-limit'], [500, 'http']])('HTTP %s', async (status, kind) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: Number(status) })));
  await expect(fetchRdap('8.8.8.8', signal())).rejects.toMatchObject({ kind });
});
it.each([['{', 'json'], ['{}', 'format'], ['null', 'format']])('不正本文 %s', async (body, kind) => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body)));
  await expect(fetchRdap('8.8.8.8', signal())).rejects.toMatchObject({ kind });
});
it('形式不正IPは送信しない', async () => {
  vi.stubGlobal('fetch', vi.fn());
  await expect(fetchRdap('https://example.test', signal())).rejects.toMatchObject({ kind: 'invalid' });
  expect(fetch).not.toHaveBeenCalled();
});
it('通信障害をCORSと断定しないnetworkとして扱う', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
  await expect(fetchRdap('8.8.8.8', signal())).rejects.toMatchObject({ kind: 'network' });
});
it.each(['fetch', 'body'])('%sの待機中に10秒でtimeout、タイマーを解放する', async (phase) => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => {
    const pending = () => new Promise((_yes, no) => init.signal!.addEventListener('abort', () => no(new DOMException('aborted', 'AbortError'))));
    return phase === 'fetch' ? pending() : Promise.resolve({ ok: true, json: pending });
  }));
  const result = expect(fetchRdap('8.8.8.8', signal())).rejects.toMatchObject({ kind: 'timeout' });
  await vi.advanceTimersByTimeAsync(10_000);
  await result;
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(vi.getTimerCount()).toBe(0);
});
it.each([true, false])('ユーザーAbort（事前=%s）を伝播し解放', async (before) => {
  vi.useFakeTimers();
  vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) => new Promise((_yes, no) => init.signal!.addEventListener('abort', () => no(new Error('aborted'))))));
  const controller = new AbortController();
  if (before) controller.abort();
  const result = expect(fetchRdap('8.8.8.8', controller.signal)).rejects.toMatchObject({ kind: 'aborted' });
  controller.abort();
  await result;
  expect(vi.getTimerCount()).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(before ? 0 : 1);
});
