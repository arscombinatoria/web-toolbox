import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { fetchIpv4 } from './api';
vi.mock('./api', () => ({ fetchIpv4: vi.fn() }));
const api = vi.mocked(fetchIpv4);
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.resetAllMocks(); vi.unstubAllGlobals(); });
function setup() {
  dispose = mount(document.body);
  return {
    output: document.querySelector('input')!,
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
