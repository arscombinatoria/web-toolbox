// @vitest-environment jsdom
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
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.resetAllMocks(); });
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
  expect(ui.input.placeholder).toBe('例：8.8.8.8');
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
it.each([
  ['not-found', 'HTTP 404：登録情報が見つかりませんでした。'],
  ['rate-limit', 'HTTP 429：問い合わせ制限に達しました。時間をおいて検索してください。'],
  ['http', 'HTTPエラー：RDAPサービスが正常に応答しませんでした。'],
  ['network', '通信エラー：ネットワークやサービスの稼働状況・CORS設定などにより取得できませんでした。'],
  ['timeout', 'タイムアウト：10秒以内に取得できませんでした。'],
  ['json', 'レスポンス形式エラー：有効なJSONではありません。'],
  ['format', 'レスポンス形式エラー：RDAPのIP Network情報ではありません。'],
] as const)('%sのエラー・安全な確認リンクと再検索回復', async (kind, expectedMessage) => {
  api.mockRejectedValueOnce(Object.assign(new Error(), { kind })).mockResolvedValueOnce(response());
  const ui = setup();
  ui.search('2001:db8::1');
  const alert = ui.view.querySelector<HTMLElement>('[role=alert]')!;
  await vi.waitFor(() => expect(alert.textContent).toContain(expectedMessage));
  const fallback = ui.view.querySelector<HTMLElement>('[data-fallback]')!;
  expect(fallback.hidden).toBe(false);
  const link = fallback.querySelector<HTMLAnchorElement>('a')!;
  expect(link.textContent).toBe('RDAP.orgで外部確認する');
  expect(link.href).toBe('https://rdap.org/ip/2001%3Adb8%3A%3A1');
  expect(link.rel).toBe('noopener noreferrer');
  ui.search('2001:db8::1');
  await vi.waitFor(() => expect(ui.view.textContent).toContain('検索が完了'));
  expect(alert.textContent).toBe('');
  expect(fallback.hidden).toBe(true);
  expect(fallback.querySelector('a')).toBeNull();
  expect(ui.view.querySelector('[data-result]')!.hasAttribute('hidden')).toBe(false);
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
  expect(ui.view.querySelector<HTMLDivElement>('[data-result]')!.hasAttribute('hidden')).toBe(true);
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
  ui.view.querySelector<HTMLButtonElement>('[data-copy-json]')!.click();
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
  ui.view.querySelector<HTMLButtonElement>('[data-copy-json]')!.click();
  ui.view.querySelector<HTMLButtonElement>('[data-copy-json]')!.click();
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

it('IP確認は明示操作のみで、成功後は検索せず入力へ設定してRDAP結果を消す', async () => {
  const rdap = response(); api.mockResolvedValue(rdap);
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false));
  const fetchStub = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ip: '203.0.113.8' }) });
  vi.stubGlobal('fetch', fetchStub);
  expect(fetchStub).not.toHaveBeenCalled();
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="4"]')!.click();
  expect(ui.view.querySelector('[data-ip-status]')!.textContent).toContain('確認中');
  await vi.waitFor(() => expect(ui.input.value).toBe('203.0.113.8'));
  expect(ui.view.querySelector('[data-ip-status]')!.textContent).toContain('検索ボタンを押す');
  expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(true);
  expect(api).toHaveBeenCalledTimes(1);
  expect(fetchStub).toHaveBeenCalledWith('https://api.ipify.org?format=json', expect.objectContaining({
    credentials: 'omit', referrerPolicy: 'no-referrer',
  }));
});

it('IP確認の失敗は入力・既存結果を保ち、IPv6非対応と断定しない', async () => {
  api.mockResolvedValue(response());
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false));
  const fetchStub = vi.fn().mockRejectedValue(new TypeError('network'));
  vi.stubGlobal('fetch', fetchStub);
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="6"]')!.click();
  await vi.waitFor(() => expect(ui.view.querySelector('[data-ip-status]')!.textContent).toContain('確認できませんでした'));
  expect(ui.input.value).toBe('8.8.8.8');
  expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false);
  expect(ui.view.querySelector('[data-ip-status]')!.textContent).not.toContain('非対応');
  expect(fetchStub).toHaveBeenCalledWith('https://api6.ipify.org?format=json', expect.any(Object));
});

it('新しいIP確認・入力編集・クリアで古いIP確認を中止し、遅い成功を無視する', async () => {
  const pending: { signal: AbortSignal; finish: (ip: string) => void }[] = [];
  const fetchStub = vi.fn((_url: string, init: RequestInit) => new Promise((resolve) => {
    const signal = init.signal as AbortSignal;
    pending.push({ signal, finish: (ip) => resolve({ ok: true, json: async () => ({ ip }) }) });
  }));
  vi.stubGlobal('fetch', fetchStub);
  const ui = setup();
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="4"]')!.click();
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="6"]')!.click();
  expect(pending[0]!.signal.aborted).toBe(true);
  pending[0]!.finish('203.0.113.1'); pending[1]!.finish('2001:db8::1');
  await vi.waitFor(() => expect(ui.input.value).toBe('2001:db8::1'));
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="4"]')!.click();
  ui.search('invalid');
  expect(pending[2]!.signal.aborted).toBe(true);
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="4"]')!.click();
  ui.input.value = 'typed'; ui.input.dispatchEvent(new Event('input'));
  expect(pending[3]!.signal.aborted).toBe(true);
  pending[3]!.finish('203.0.113.2'); await Promise.resolve();
  expect(ui.input.value).toBe('typed');
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="6"]')!.click();
  ui.view.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(pending[4]!.signal.aborted).toBe(true);
  expect(ui.input.value).toBe('');
  expect(document.activeElement).toBe(ui.input);
  ui.view.querySelector<HTMLButtonElement>('[data-own-ip="4"]')!.click();
  dispose!(); dispose = undefined;
  expect(pending[5]!.signal.aborted).toBe(true);
  pending[5]!.finish('203.0.113.3'); await Promise.resolve();
  expect(ui.input.value).toBe('');
});

it('RDAP結果コピーは共有表示データと結果セクション順を使い、失敗後も結果を残す', async () => {
  const writeText = vi.fn().mockRejectedValue(new Error());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  api.mockResolvedValue(response());
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false));
  expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.nextElementSibling).toBe(ui.view.querySelector<HTMLDivElement>('[data-result]'));
  expect(ui.view.querySelector('[data-result] h2')!.textContent).toBe('ネットワーク情報');
  ui.view.querySelector<HTMLButtonElement>('[data-copy-result]')!.click();
  await vi.waitFor(() => expect(ui.view.querySelector('[data-copy-status]')!.textContent).toContain('手動でコピー'));
  const summary = writeText.mock.calls[0]![0] as string;
  expect(summary).toContain('IP登録情報検索（RDAP）\n検索対象: 8.8.8.8');
  expect(summary).toContain('■ ネットワーク情報');
  expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false);
});

it('JSON保存は同じ整形JSONをUTF-8で保存し、IPv6名・URL寿命・破棄を管理する', async () => {
  vi.useFakeTimers();
  api.mockResolvedValue(response());
  const create = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rdap-test');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const ui = setup('2001:db8::1');
  await vi.waitFor(() => expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false));
  const expected = ui.view.querySelector('pre')!.textContent!;
  ui.view.querySelector<HTMLButtonElement>('[data-save-json]')!.click();
  expect(click).toHaveBeenCalledOnce();
  const anchor = click.mock.contexts[0] as HTMLAnchorElement;
  expect(anchor.download).toBe('rdap-2001-db8--1.json');
  const blob = create.mock.calls[0]![0] as Blob;
  expect(blob.type).toBe('application/json;charset=utf-8');
  expect(await blob.text()).toBe(expected);
  expect(ui.view.querySelector('[data-copy-status]')!.textContent).toContain('ダウンロードを開始しました');
  vi.advanceTimersByTime(999); expect(revoke).not.toHaveBeenCalled();
  vi.advanceTimersByTime(1); expect(revoke).toHaveBeenCalledWith('blob:rdap-test');

  create.mockReturnValue('blob:rdap-dispose');
  ui.view.querySelector<HTMLButtonElement>('[data-save-json]')!.click();
  dispose!(); dispose = undefined;
  expect(revoke).toHaveBeenCalledWith('blob:rdap-dispose');
  expect(revoke).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(1000);
  expect(revoke).toHaveBeenCalledTimes(2);
});

it('クリアは結果・エラー・通知を消し、JSON保存失敗を通知する', async () => {
  api.mockResolvedValue(response());
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false));
  vi.spyOn(URL, 'createObjectURL').mockImplementation(() => { throw new Error(); });
  ui.view.querySelector<HTMLButtonElement>('[data-save-json]')!.click();
  expect(ui.view.querySelector('[data-copy-status]')!.textContent).toContain('生成できませんでした');
  ui.view.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(ui.input.value).toBe('');
  expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(true);
  expect(ui.view.querySelector<HTMLDivElement>('[data-result]')!.hidden).toBe(true);
  expect(ui.view.querySelector('[role=alert]')!.textContent).toBe('');
  expect(ui.view.querySelector('[data-ip-status]')!.textContent).toBe('');
  expect(ui.view.querySelector('[data-copy-status]')!.textContent).toBe('');
});

it('遅れて完了した古いコピーは新しいダウンロード通知を上書きしない', async () => {
  let complete!: () => void;
  const writeText = vi.fn(() => new Promise<void>((resolve) => { complete = resolve; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  api.mockResolvedValue(response());
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:rdap-notice-order');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const ui = setup('8.8.8.8');
  await vi.waitFor(() => expect(ui.view.querySelector<HTMLDivElement>('[data-result-actions]')!.hidden).toBe(false));
  ui.view.querySelector<HTMLButtonElement>('[data-copy-result]')!.click();
  ui.view.querySelector<HTMLButtonElement>('[data-save-json]')!.click();
  expect(ui.view.querySelector('[data-copy-status]')!.textContent).toContain('ダウンロードを開始しました');
  complete(); await Promise.resolve();
  expect(ui.view.querySelector('[data-copy-status]')!.textContent).toContain('ダウンロードを開始しました');
});
