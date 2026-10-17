import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchIpv4, isIpv4 } from './api';

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
const controller = () => new AbortController();
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('IPv4取得', () => {
  it('検証したIPv4を返し、キャッシュ・資格情報・リファラーを送らない', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response({ ip: '203.0.113.42' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchIpv4(controller().signal)).resolves.toBe('203.0.113.42');
    expect(fetchMock).toHaveBeenCalledWith('https://api.ipify.org?format=json', expect.objectContaining({
      cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: expect.any(AbortSignal),
    }));
  });
  it.each([400, 404, 500, 503])('HTTP %sを区別する', async (status) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({}, status)));
    await expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'http' });
  });
  it('ネットワークエラーを区別する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
    await expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'network' });
  });
  it('不正JSONを拒否する', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{')));
    await expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'format' });
  });
  it('本文読み込み中のTypeErrorを通信エラーとして扱う', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new TypeError('body read failed')),
    }));
    await expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'network' });
  });
  it.each([null, [], {}, { ip: 42 }, { ip: null }, { ip: '256.0.0.1' }, { ip: '::1' }])('不正レスポンス %jを拒否する', async (body) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    await expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'format' });
  });
  it.each(['0.0.0.0', '255.255.255.255', '1.2.3.4'])('%sはIPv4形式', (ip) => expect(isIpv4(ip)).toBe(true));
  it.each(['01.2.3.4', '1.2.3', '1.2.3.4.5', '-1.2.3.4', '+1.2.3.4', '1e2.2.3.4', '1.2.3.4\n', ' 1.2.3.4', '1..3.4', '１.2.3.4'])('%sは拒否', (ip) => expect(isIpv4(ip)).toBe(false));

  function pendingFetch() {
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => new Promise<Response>((_resolve, reject) => {
      options.signal!.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    })));
  }
  it('10秒で中止しタイマーを解放する（自動リトライなし）', async () => {
    vi.useFakeTimers();
    pendingFetch();
    const result = expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });
  it('外部AbortControllerの中止を伝えタイマーを解放する', async () => {
    vi.useFakeTimers();
    pendingFetch();
    const abort = controller();
    const result = expect(fetchIpv4(abort.signal)).rejects.toMatchObject({ kind: 'aborted' });
    abort.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('中止済みならリクエストしない', async () => {
    vi.stubGlobal('fetch', vi.fn());
    const abort = controller();
    abort.abort();
    await expect(fetchIpv4(abort.signal)).rejects.toMatchObject({ kind: 'aborted' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('JSON本文の読み込み中にもタイムアウトする', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new Error('aborted')));
      }),
    })));
    const result = expect(fetchIpv4(controller().signal)).rejects.toMatchObject({ kind: 'timeout' });
    await vi.advanceTimersByTimeAsync(10_000);
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('JSON本文の読み込み中の中止をabortedとして扱う', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, options: RequestInit) => Promise.resolve({
      ok: true,
      json: () => new Promise((_resolve, reject) => {
        options.signal!.addEventListener('abort', () => reject(new TypeError('aborted')));
      }),
    })));
    const abort = controller();
    const result = expect(fetchIpv4(abort.signal)).rejects.toMatchObject({ kind: 'aborted' });
    await Promise.resolve();
    await Promise.resolve();
    abort.abort();
    await result;
    expect(vi.getTimerCount()).toBe(0);
  });
});
