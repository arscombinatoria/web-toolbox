import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { verifySignature, type Verification } from './verify';
vi.mock('./verify', () => ({ algorithms: ['HS256', 'RS256', 'ES256'], verifySignature: vi.fn() }));
const token = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ0ZXN0In0.';
let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.unstubAllGlobals(); });
const field = (id: string) => document.querySelector<HTMLInputElement>(`#jwt-${id}`)!;
const fill = (id: string, value: string) => { field(id).value = value; field(id).dispatchEvent(new Event('input')); };
it.each(['input', 'secret', 'clear', 'dispose'])('%s後に古い検証結果を反映しない', async action => {
  let finish!: (result: Verification) => void;
  vi.mocked(verifySignature).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  dispose = mount(document.body); fill('input', token); fill('secret', 'test-secret');
  const view = document.querySelector('.jwt-tool')!;
  const input = field('input'); const secret = field('secret');
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  if (action === 'clear') document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  else if (action === 'dispose') dispose();
  else fill(action, 'changed');
  finish({ state: 'match', message: '署名一致' }); await Promise.resolve(); await Promise.resolve();
  if (action === 'dispose') { expect(input.value).toBe(''); expect(secret.value).toBe(''); }
  else expect(view.querySelector('[data-verification]')!.textContent).toBe('未検証');
});
it('不正入力で結果を消し、保存せず、コピー失敗を案内する', async () => {
  const storage = vi.spyOn(Storage.prototype, 'setItem');
  const history = vi.spyOn(window.history, 'replaceState');
  vi.stubGlobal('navigator', { clipboard: { writeText: vi.fn().mockRejectedValue(new Error()) } });
  dispose = mount(document.body); fill('input', token);
  document.querySelector<HTMLButtonElement>('[data-copy="header"]')!.click();
  await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-copy-status]')!.textContent).toContain('手動');
  expect(field('header').value).toContain('HS256');
  fill('input', '!'); expect(field('header').value).toBe(''); expect(field('payload').value).toBe('');
  expect(storage).not.toHaveBeenCalled(); expect(history).not.toHaveBeenCalled();
});
it.each(['jwt-alg', 'jwt-encoding'])('%s変更でも検証を無効化する', async id => {
  let finish!: (result: Verification) => void;
  vi.mocked(verifySignature).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  dispose = mount(document.body); fill('input', token);
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  const select = document.getElementById(id) as HTMLSelectElement;
  select.selectedIndex = 1; select.dispatchEvent(new Event('change'));
  finish({ state: 'match', message: '署名一致' }); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-verification]')!.textContent).toBe('未検証');
});
it('コピー完了前の入力変更で古い通知を抑止する', async () => {
  let finish!: () => void;
  vi.stubGlobal('navigator', { clipboard: { writeText: () => new Promise<void>(resolve => { finish = resolve; }) } });
  dispose = mount(document.body); fill('input', token);
  document.querySelector<HTMLButtonElement>('[data-copy="header"]')!.click();
  fill('input', '!'); finish(); await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-copy-status]')!.textContent).toBe('');
});

it('Header algに応じて明示選択を案内する', () => {
  dispose = mount(document.body);
  fill('input', 'eyJhbGciOiJSUzI1NiJ9.e30.');
  expect(document.querySelector('[data-alg-help]')!.textContent).toContain('RS256を選択');
  const select = field('alg'); select.value = 'RS256'; select.dispatchEvent(new Event('change'));
  expect(document.querySelector('[data-alg-help]')!.textContent).toBe('');
  fill('input', 'eyJhbGciOiJub25lIn0.e30.');
  expect(document.querySelector('[data-alg-help]')!.textContent).toContain('非対応');
});
it('元の数値表現を表示・コピーし、精度警告を入力変更で消去する', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  dispose = mount(document.body);
  const source = '{"exp":1e-400,"n":9223372036854775807,"f":0.1234567890123456789012345,"z":-0}';
  const segment = btoa(source).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  fill('input', `${segment}.${segment}.`);
  expect(field('header').value).toContain('9223372036854775807');
  expect(field('payload').value).toContain('0.1234567890123456789012345');
  expect(document.querySelector('[data-claims]')!.textContent).toContain('数値精度');
  for (const part of ['header', 'payload']) {
    document.querySelector<HTMLButtonElement>(`[data-copy="${part}"]`)!.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenLastCalledWith(field(part).value);
  }
  fill('input', token);
  expect(document.querySelector('[data-claims]')!.textContent).not.toContain('数値精度');
});
