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
