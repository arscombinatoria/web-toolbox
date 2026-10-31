import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { verifySignature, type Verification } from './verify';
vi.mock('./verify', () => ({ verifySignature: vi.fn() }));
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
