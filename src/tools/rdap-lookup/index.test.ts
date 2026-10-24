import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { fetchRdap, type RdapResult } from './api';
import { parseRdap } from './logic';
import { network } from './__tests__/fixture';
vi.mock('./api', () => ({ fetchRdap: vi.fn() }));
const api = vi.mocked(fetchRdap);
const response = (name = 'EXAMPLE'): RdapResult => {
  const data = { ...network, name };
  return { data, info: parseRdap(data), url: 'https://rdap.example.test/ip/8.8.8.8' };
};
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.resetAllMocks(); });
function setup(initial?: string) {
  dispose = mount(document.body, initial);
  const view = document.querySelector<HTMLElement>('.rdap-tool')!;
  const input = view.querySelector('input')!;
  return { view, input, search: (ip: string) => {
    input.value = ip;
    view.querySelector('form')!.dispatchEvent(new Event('submit', { cancelable: true }));
  } };
}
it('通常表示では通信せず、空白除去・不正入力を扱う', async () => {
  const ui = setup();
  expect(api).not.toHaveBeenCalled();
  ui.search('  invalid  ');
  expect(ui.input.value).toBe('invalid');
  expect(ui.input.getAttribute('aria-invalid')).toBe('true');
  expect(api).not.toHaveBeenCalled();
  expect(ui.view.querySelector('[data-fallback]')!.hasAttribute('hidden')).toBe(true);
  api.mockResolvedValue(response());
  ui.search('  8.8.8.8  ');
  await vi.waitFor(() => expect(ui.view.textContent).toContain('検索が完了'));
  expect(api).toHaveBeenCalledWith('8.8.8.8', expect.any(AbortSignal));
  expect(ui.view.textContent).toContain('abuse@example.test');
});
it.each(['not-found', 'rate-limit', 'http', 'network', 'timeout', 'json', 'format'])('%sのエラーと検証済みIPの安全な外部確認リンク', async (kind) => {
  api.mockRejectedValue(Object.assign(new Error(), { kind }));
  const ui = setup();
  ui.search('2001:db8::1');
  await vi.waitFor(() => expect(ui.view.querySelector('[role=alert]')!.textContent).not.toBe(''));
  const link = ui.view.querySelector<HTMLAnchorElement>('[data-fallback] a')!;
  expect(link.href).toBe('https://rdap.org/ip/2001%3Adb8%3A%3A1');
  expect(link.rel).toBe('noopener noreferrer');
});
it.each(['resolve', 'reject'])('再検索前の%sを無視する', async (outcome) => {
  let resolve!: (value: RdapResult) => void;
  let reject!: (reason: Error) => void;
  api.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; })).mockResolvedValueOnce(response('LATEST'));
  const ui = setup();
  ui.search('8.8.8.8');
  ui.search('1.1.1.1');
  expect(api.mock.calls[0]![1].aborted).toBe(true);
  await vi.waitFor(() => expect(ui.view.textContent).toContain('LATEST'));
  const markup = ui.view.innerHTML;
  if (outcome === 'resolve') resolve(response('OLD'));
  else reject(new Error());
  await Promise.resolve();
  expect(ui.view.innerHTML).toBe(markup);
});
it.each(['resolve', 'reject'])('破棄後の%sは更新せず、イベントを解除する', async (outcome) => {
  let resolve!: (value: RdapResult) => void;
  let reject!: (reason: Error) => void;
  api.mockReturnValueOnce(new Promise((yes, no) => { resolve = yes; reject = no; }));
  const ui = setup('8.8.8.8');
  dispose!();
  const markup = ui.view.innerHTML;
  expect(api.mock.calls[0]![1].aborted).toBe(true);
  if (outcome === 'resolve') resolve(response());
  else reject(new Error());
  await Promise.resolve();
  expect(ui.view.innerHTML).toBe(markup);
  ui.search('1.1.1.1');
  expect(api).toHaveBeenCalledTimes(1);
});
it('入力変更で中止し、古い検索結果を表示しない', async () => {
  let complete!: (value: RdapResult) => void;
  api.mockReturnValue(new Promise((yes) => { complete = yes; }));
  const ui = setup('8.8.8.8');
  ui.input.value = 'invalid';
  ui.input.dispatchEvent(new Event('input'));
  expect(api.mock.calls[0]![1].aborted).toBe(true);
  complete(response());
  await Promise.resolve();
  expect(ui.view.querySelector('[data-result]')!.hasAttribute('hidden')).toBe(true);
  expect(ui.view.textContent).not.toContain('EXAMPLE');
});
it.each(['success', 'failure'])('JSONは安全な折りたたみ表示でコピー %s', async (mode) => {
  const writeText = mode === 'success' ? vi.fn().mockResolvedValue(undefined) : vi.fn().mockRejectedValue(new Error());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  api.mockResolvedValue(response('<img src=x onerror=alert(1)>'));
  const ui = setup('2001:db8::1');
  await vi.waitFor(() => expect(ui.view.querySelector('details')!.hidden).toBe(false));
  expect(ui.view.querySelector('details')!.open).toBe(false);
  expect(ui.view.querySelector('img')).toBeNull();
  const json = ui.view.querySelector('pre')!.textContent!;
  expect(JSON.parse(json).name).toContain('<img');
  ui.view.querySelector<HTMLButtonElement>('[data-copy]')!.click();
  await vi.waitFor(() => expect(ui.view.textContent).toContain(mode === 'success' ? 'コピーしました' : '手動でコピー'));
  expect(writeText).toHaveBeenCalledWith(json);
});
it.each(['input', 'search', 'dispose'])('コピー待機中の%s後に通知しない', async (action) => {
  let complete!: () => void;
  const writeText = vi.fn(() => new Promise<void>((yes) => { complete = yes; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  api.mockResolvedValue(response());
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector('details')!.hidden).toBe(false));
  ui.view.querySelector<HTMLButtonElement>('[data-copy]')!.click();
  ui.view.querySelector<HTMLButtonElement>('[data-copy]')!.click();
  expect(writeText).toHaveBeenCalledTimes(1);
  if (action === 'dispose') dispose!();
  else if (action === 'search') { ui.search('1.1.1.1'); await vi.waitFor(() => expect(api).toHaveBeenCalledTimes(2)); }
  else ui.input.dispatchEvent(new Event('input'));
  complete();
  await Promise.resolve();
  expect(ui.view.querySelector('[data-copy-status]')!.textContent).toBe('');
});

it('不完全なIP Networkでも生JSONと情報なしを表示する', async () => {
  const data = { objectClassName: 'ip network', unknown_extension: true };
  api.mockResolvedValue({ data, info: parseRdap(data), url: 'http://insecure.example.test/' });
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector('details')!.hidden).toBe(false));
  expect(ui.view.textContent).toContain('情報なし');
  expect(ui.view.querySelector('pre')!.textContent).toBe(JSON.stringify(data, null, 2));
  expect(ui.view.querySelector('[data-result] a')).toBeNull();
});
