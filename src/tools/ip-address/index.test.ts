import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { fetchIpv4, fetchIpv6 } from './api';
vi.mock('./api', () => ({ fetchIpv4: vi.fn(), fetchIpv6: vi.fn() }));
const api = vi.mocked(fetchIpv4);
const api6 = vi.mocked(fetchIpv6);
beforeEach(() => api6.mockResolvedValue('2001:db8::1'));
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  dispose = mount(document.body);
  return {
    output: document.querySelector('input')!,
    output6: document.querySelector('textarea')!,
    copy6: document.querySelector<HTMLButtonElement>('[data-version=IPv6] [data-copy]')!,
    copy: document.querySelector<HTMLButtonElement>('[data-copy]')!,
    refresh: document.querySelector<HTMLButtonElement>('[data-refresh]')!,
    view: document.querySelector('.ip-tool')!,
  };
}
it('IPv6の高さを取得・リサイズ・再取得時に再計算し、破棄時に解除する', async () => {
  api.mockResolvedValue('1.2.3.4');
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    borderTopWidth: '1px', borderBottomWidth: '1px',
  } as CSSStyleDeclaration);
  let contentHeight = 48;
  const measure = vi.spyOn(HTMLTextAreaElement.prototype, 'scrollHeight', 'get')
    .mockImplementation(function (this: HTMLTextAreaElement) {
      expect(this.style.height).toBe('auto');
      return contentHeight;
    });
  const ui = setup();
  expect(ui.output6.rows).toBe(1);
  expect(ui.output6.readOnly).toBe(true);
  expect(ui.output6.style.height).toBe('50px');
  contentHeight = 96;
  await vi.waitFor(() => expect(ui.output6.value).toBe('2001:db8::1'));
  expect(ui.output6.style.height).toBe('98px');
  contentHeight = 48;
  window.dispatchEvent(new Event('resize'));
  expect(ui.output6.style.height).toBe('50px');
  contentHeight = 96;
  window.dispatchEvent(new Event('resize'));
  expect(ui.output6.style.height).toBe('98px');
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  contentHeight = 48;
  api6.mockReturnValueOnce(new Promise(() => {}));
  ui.refresh.click();
  expect(ui.output6.value).toBe('');
  expect(ui.output6.style.height).toBe('50px');
  dispose!();
  measure.mockClear();
  window.dispatchEvent(new Event('resize'));
  expect(measure).not.toHaveBeenCalled();
});
it('初回取得・連打抑止・再取得時の旧IP消去', async () => {
  api.mockResolvedValueOnce('203.0.113.42');
  const ui = setup();
  expect(ui.refresh.disabled).toBe(true);
  ui.refresh.dispatchEvent(new Event('click'));
  expect(api).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(ui.output.value).toBe('203.0.113.42'));
  api.mockReturnValueOnce(new Promise(() => {}));
  ui.refresh.click();
  expect(ui.output.value).toBe('');
  expect(ui.copy.disabled).toBe(true);
  expect(api.mock.calls[0]![0].aborted).toBe(true);
});
it.each(['network', 'http', 'timeout', 'format'])('%sの表示後に再取得できる', async (kind) => {
  api.mockRejectedValueOnce(Object.assign(new Error(), { kind })).mockResolvedValueOnce('1.2.3.4');
  const ui = setup();
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  expect(ui.view.textContent).toContain('再取得してください');
  expect(ui.copy.disabled).toBe(true);
  ui.refresh.click();
  await vi.waitFor(() => expect(ui.output.value).toBe('1.2.3.4'));
});
it.each(['success', 'denied', 'unavailable'])('コピー: %s', async (mode) => {
  api.mockResolvedValue('1.2.3.4');
  const writeText = mode === 'success' ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: mode === 'unavailable' ? undefined : { writeText } });
  const ui = setup();
  await vi.waitFor(() => expect(ui.copy.disabled).toBe(false));
  ui.copy.click();
  await vi.waitFor(() => expect(ui.view.textContent).toContain(mode === 'success' ? 'コピーしました' : '手動でコピー'));
  if (mode !== 'unavailable') expect(writeText).toHaveBeenCalledWith('1.2.3.4');
  expect(ui.output.readOnly).toBe(true);
});
it.each(['resolve', 'reject'])('破棄後の通信%sはDOMを変更せずリスナーを残さない', async (mode) => {
  let resolve!: (ip: string) => void;
  let reject!: (error: Error) => void;
  api.mockReturnValue(new Promise<string>((res, rej) => { resolve = res; reject = rej; }));
  const ui = setup();
  const oldMarkup = ui.view.innerHTML;
  dispose!();
  expect(api.mock.calls[0]![0].aborted).toBe(true);
  if (mode === 'resolve') resolve('1.2.3.4');
  else reject(new Error());
  await Promise.resolve();
  await Promise.resolve();
  expect(ui.view.innerHTML).toBe(oldMarkup);
  ui.refresh.dispatchEvent(new Event('click'));
  expect(api).toHaveBeenCalledTimes(1);
  expect(document.body.children.length).toBe(0);
});
it('コピー待機中に破棄しても結果を通知しない', async () => {
  api.mockResolvedValue('1.2.3.4');
  let complete!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>((resolve) => { complete = resolve; }),
  } });
  const ui = setup();
  await vi.waitFor(() => expect(ui.copy.disabled).toBe(false));
  ui.copy.click();
  dispose!();
  const markup = ui.view.innerHTML;
  complete();
  await Promise.resolve();
  expect(ui.view.innerHTML).toBe(markup);
});

it.each([[true, true], [true, false], [false, true], [false, false]])(
  '独立した取得結果 IPv4成功=%s IPv6成功=%s', async (v4, v6) => {
    const failure = Object.assign(new Error(), { kind: 'network' });
    if (v4) api.mockResolvedValue('1.2.3.4');
    else api.mockRejectedValue(failure);
    if (v6) api6.mockResolvedValue('2001:db8::1');
    else api6.mockRejectedValue(failure);
    const ui = setup();
    expect(api).toHaveBeenCalledTimes(1);
    expect(api6).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
    expect(ui.output.value).toBe(v4 ? '1.2.3.4' : '');
    expect(ui.output6.value).toBe(v6 ? '2001:db8::1' : '');
    expect(ui.copy.disabled).toBe(!v4);
    expect(ui.copy6.disabled).toBe(!v6);
    for (const [version, success] of [['IPv4', v4], ['IPv6', v6]]) {
      expect(ui.view.querySelector(`[data-version=${version}] .ip-status`)!.textContent)
        .toContain(success ? '取得成功' : '通信エラー');
    }
  },
);
it.each(['IPv4', 'IPv6'])('%sだけ先に完了しても表示・コピーでき、両方を再取得する', async (version) => {
  let complete!: (ip: string) => void;
  const slow = version === 'IPv4' ? api6 : api;
  api.mockResolvedValue('1.2.3.4');
  slow.mockReturnValueOnce(new Promise<string>((resolve) => { complete = resolve; }));
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  const ui = setup();
  const output = version === 'IPv4' ? ui.output : ui.output6;
  const copy = version === 'IPv4' ? ui.copy : ui.copy6;
  await vi.waitFor(() => expect(copy.disabled).toBe(false));
  expect(ui.refresh.disabled).toBe(true);
  copy.click();
  expect(writeText).toHaveBeenCalledWith(output.value);
  complete(version === 'IPv4' ? '2001:db8::1' : '1.2.3.4');
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  ui.refresh.click();
  expect(api).toHaveBeenCalledTimes(2);
  expect(api6).toHaveBeenCalledTimes(2);
});
it('IPv6の破棄後の取得結果を反映しない', async () => {
  api.mockResolvedValue('1.2.3.4');
  let complete!: (ip: string) => void;
  api6.mockReturnValue(new Promise<string>((resolve) => { complete = resolve; }));
  const ui = setup();
  dispose!();
  expect(api6.mock.calls[0]![0].aborted).toBe(true);
  const markup = ui.view.innerHTML;
  complete('2001:db8::1');
  await Promise.resolve();
  await Promise.resolve();
  expect(ui.view.innerHTML).toBe(markup);
});
it('再取得前のIPv6コピー結果を新しい取得結果に通知しない', async () => {
  api.mockResolvedValue('1.2.3.4');
  let complete!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>((resolve) => { complete = resolve; }),
  } });
  const ui = setup();
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  ui.copy6.click();
  ui.refresh.click();
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  complete();
  await Promise.resolve();
  expect(ui.view.querySelector('[data-version=IPv6] .ip-copy-status')!.textContent).toBe('');
  expect(ui.copy6.disabled).toBe(false);
});

function deferredAddress() {
  let resolve!: (ip: string) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<string>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

it.each(['resolve', 'reject'] as const)('再マウントの成功後に旧IPv4・IPv6の%sが届いても新旧DOMを変更しない', async (outcome) => {
  const old4 = deferredAddress();
  const old6 = deferredAddress();
  api.mockReturnValueOnce(old4.promise).mockResolvedValueOnce('198.51.100.7');
  api6.mockReturnValueOnce(old6.promise).mockResolvedValueOnce('2001:db8::2');
  const old = setup();
  const signal = api.mock.calls[0]![0];
  expect(api6.mock.calls[0]![0]).toBe(signal);
  dispose!();
  expect(signal.aborted).toBe(true);
  const oldMarkup = old.view.innerHTML;
  const latest = setup();
  await vi.waitFor(() => expect(latest.refresh.disabled).toBe(false));
  const latestMarkup = latest.view.innerHTML;
  // Abortを無視するAPIを模し、古い処理を最新の成功より後に完了させる。
  if (outcome === 'resolve') {
    old6.resolve('2001:db8::1');
    old4.resolve('192.0.2.1');
  } else {
    old6.reject(new Error('old IPv6 failure'));
    old4.reject(new Error('old IPv4 failure'));
  }
  // retrieveのcatch/finally、Promise.all後の継続まで待つ。
  await Promise.allSettled([old4.promise, old6.promise]);
  await Promise.resolve();
  expect(old.view.innerHTML).toBe(oldMarkup);
  expect(old.output.value).toBe('');
  expect(old.output6.value).toBe('');
  expect(latest.view.innerHTML).toBe(latestMarkup);
  expect(latest.output.value).toBe('198.51.100.7');
  expect(latest.output6.value).toBe('2001:db8::2');
  expect(latest.refresh.disabled).toBe(false);
  expect(latest.view.querySelector('[aria-busy]')).toBeNull();
  old.refresh.dispatchEvent(new Event('click'));
  expect(api).toHaveBeenCalledTimes(2);
  expect(api6).toHaveBeenCalledTimes(2);
});

it.each(['IPv4', 'IPv6'] as const)('再取得中に%sだけ完了しても連打を抑止し、残りの失敗後に操作を復帰する', async (first) => {
  api.mockResolvedValueOnce('192.0.2.1');
  const ui = setup();
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  const v4 = deferredAddress();
  const v6 = deferredAddress();
  api.mockReturnValueOnce(v4.promise);
  api6.mockReturnValueOnce(v6.promise);
  ui.refresh.click();
  const fast = first === 'IPv4' ? v4 : v6;
  const slow = first === 'IPv4' ? v6 : v4;
  const output = first === 'IPv4' ? ui.output : ui.output6;
  const pendingOutput = first === 'IPv4' ? ui.output6 : ui.output;
  const address = first === 'IPv4' ? '198.51.100.7' : '2001:db8::2';
  for (let i = 0; i < 3; i++) ui.refresh.dispatchEvent(new Event('click'));
  fast.resolve(address);
  await fast.promise;
  expect(output.value).toBe(address);
  expect(output.hasAttribute('aria-busy')).toBe(false);
  expect(pendingOutput.getAttribute('aria-busy')).toBe('true');
  expect(ui.refresh.disabled).toBe(true);
  for (let i = 0; i < 3; i++) ui.refresh.dispatchEvent(new Event('click'));
  expect(api).toHaveBeenCalledTimes(2);
  expect(api6).toHaveBeenCalledTimes(2);
  slow.reject(Object.assign(new Error('offline'), { kind: 'network' }));
  await vi.waitFor(() => expect(ui.refresh.disabled).toBe(false));
  expect(output.value).toBe(address);
  expect(pendingOutput.value).toBe('');
  expect(ui.view.querySelector('[aria-busy]')).toBeNull();
  expect(ui.view.querySelectorAll('.ip-status')[first === 'IPv4' ? 1 : 0]!.textContent).toContain('通信エラー');
});
