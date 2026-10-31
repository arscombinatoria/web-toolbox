import { DEMO_SECRET, SAMPLE_JWT } from './sample';
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

it('初期サンプルを解析し、自動検証せず、初期デモSecretだけをJWT変更で消去する', () => {
  vi.mocked(verifySignature).mockClear();
  dispose = mount(document.body);
  expect(field('input').value).toBe(SAMPLE_JWT);
  expect(JSON.parse(field('header').value)).toEqual({ alg: 'HS256', typ: 'JWT' });
  expect(JSON.parse(field('payload').value).name).toBe('サンプルユーザー');
  expect(field('signature').value).toBe(SAMPLE_JWT.split('.')[2]);
  expect(document.querySelector('[data-claims]')!.textContent).toContain('UTC');
  expect(document.querySelector('[data-claims]')!.textContent).toContain('JST');
  expect(field('alg').value).toBe('HS256'); expect(field('encoding').value).toBe('utf8');
  expect(field('secret').value).toBe(DEMO_SECRET); expect(field('secret').type).toBe('password');
  expect(document.querySelector('[data-verification]')!.textContent).toBe('未検証');
  expect(verifySignature).not.toHaveBeenCalled();
  fill('input', token); expect(field('secret').value).toBe('');
});
it.each(['my-secret', DEMO_SECRET])('手動編集したSecretは同じデモ文字列でも保持する: %s', value => {
  dispose = mount(document.body); fill('secret', value); fill('input', token);
  expect(field('secret').value).toBe(value);
});
it('クリアでは全入力と解析結果を消し、再mountでサンプルを戻す', () => {
  dispose = mount(document.body); fill('public', 'public-key');
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  for (const id of ['input', 'secret', 'public', 'header', 'payload', 'signature']) expect(field(id).value).toBe('');
  expect(document.querySelector('[data-claims]')!.textContent).toBe('');
  expect(document.querySelector('[data-verification]')!.textContent).toBe('未検証');
  dispose(); dispose = mount(document.body);
  expect(field('input').value).toBe(SAMPLE_JWT); expect(field('secret').value).toBe(DEMO_SECRET);
  field('alg').value = 'RS256'; field('alg').dispatchEvent(new Event('change'));
  expect(field('secret').value).toBe(''); expect(field('public').value).toBe('');
});

it('表示層を操作してもコピー・検証はtextarea.valueを使用し、破棄時に監視を解除する', async () => {
  const disconnect = vi.fn();
  vi.stubGlobal('ResizeObserver', class { observe = vi.fn(); disconnect = disconnect; });
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  vi.mocked(verifySignature).mockResolvedValue({ state: 'match', message: '署名一致' });
  dispose = mount(document.body);
  const layers = [...document.querySelectorAll<HTMLElement>('.jwt-highlight-layer')];
  for (const id of ['input', 'header', 'payload']) {
    const layer = field(id).parentElement!.querySelector('pre')!;
    expect(layer.textContent).toBe(field(id).value);
    expect(layer.getAttribute('aria-hidden')).toBe('true');
  }
  layers.forEach(layer => { layer.textContent = '<img src=x> altered'; });
  document.querySelector<HTMLButtonElement>('[data-copy="payload"]')!.click();
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  await Promise.resolve();
  expect(writeText).toHaveBeenLastCalledWith(field('payload').value);
  expect(verifySignature).toHaveBeenLastCalledWith(SAMPLE_JWT, 'HS256', DEMO_SECRET, 'utf8');
  const input = field('input');
  input.dispatchEvent(new Event('compositionstart'));
  expect(input.parentElement!.classList.contains('jwt-highlight-active')).toBe(false);
  input.dispatchEvent(new Event('compositionend'));
  expect(input.parentElement!.classList.contains('jwt-highlight-active')).toBe(true);
  dispose();
  expect(disconnect).toHaveBeenCalledTimes(3);
  expect(layers.every(layer => layer.textContent === '')).toBe(true);
  input.dispatchEvent(new Event('compositionend'));
  expect(layers.every(layer => layer.textContent === '')).toBe(true);
});

it('描画上限でプレーン表示にしてもデコード・検証・コピーを無効化しない', async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  dispose = mount(document.body);
  const source = '{"many":[' + '0,'.repeat(3000) + '0]}';
  const segment = btoa(source).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  fill('input', `e30.${segment}.`);
  const layer = field('payload').parentElement!.querySelector('pre')!;
  expect(layer.children).toHaveLength(0);
  expect(layer.textContent).toBe(field('payload').value);
  expect(document.querySelector<HTMLButtonElement>('[data-verify]')!.disabled).toBe(false);
  document.querySelector<HTMLButtonElement>('[data-copy="payload"]')!.click();
  await Promise.resolve();
  expect(writeText).toHaveBeenLastCalledWith(field('payload').value);
});
