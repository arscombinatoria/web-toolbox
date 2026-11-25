// @vitest-environment jsdom
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
it('検証ボタンに隠しSVGアイコンを表示し、ボタン名を維持する', () => {
  dispose = mount(document.body);
  const button = document.querySelector<HTMLButtonElement>('[data-verify]')!;
  const icon = button.querySelector('svg.icon')!;
  expect(icon.getAttribute('width')).toBe('16');
  expect(icon.getAttribute('height')).toBe('16');
  expect(icon.getAttribute('aria-hidden')).toBe('true');
  expect(button.textContent?.trim()).toBe('検証');
  expect(button.hasAttribute('aria-label')).toBe(false);
});
it('モバイル操作順のDOMで構成し、Claimsを全幅に置きClaimの関連付けを保つ', () => {
  dispose = mount(document.body);
  const tool = document.querySelector('.jwt-tool')!;
  expect(tool.querySelector('h1')?.getAttribute('tabindex')).toBe('-1');
  const workspace = tool.querySelector('.jwt-workspace')!;
  const signature = tool.querySelector('.jwt-signature')!;
  const claims = tool.querySelector('.jwt-claims')!;
  const decoded = tool.querySelector('.jwt-decoded')!;
  const verification = tool.querySelector('.jwt-verification')!;
  expect([...workspace.children]).toEqual([tool.querySelector('.jwt-source'), signature, decoded]);
  expect(decoded.querySelector('#jwt-header')!.closest('.jwt-editors')!.compareDocumentPosition(verification) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(claims.previousElementSibling).toBe(workspace);
  expect(decoded.contains(verification)).toBe(true);
  const allClaims = [...claims.querySelectorAll('dl > .jwt-claim')];
  expect(allClaims).toHaveLength(7);
  for (const item of allClaims) expect([...item.children].map(node => node.tagName)).toEqual(['DT', 'DD']);
  expect(tool.querySelector('#jwt-input')?.getAttribute('aria-describedby')).toBe('jwt-privacy jwt-sample');
  for (const id of ['input', 'header', 'payload', 'signature', 'secret', 'public', 'alg', 'encoding']) {
    expect(tool.querySelector(`#jwt-${id}`)).toBeTruthy();
  }
});
it.each([
  ['match', '署名一致', '署名一致'],
  ['mismatch', '署名不一致', '署名不一致'],
  ['unavailable', '検証不可: キー形式が不正です。', '検証不可'],
] as const)('署名検証の%s状態をdata-state・アイコン・ラベル・詳細に同期する', async (state, message, label) => {
  vi.mocked(verifySignature).mockResolvedValue({ state, message, ...(state === 'match' ? { warning: '鍵長の警告' } : {}) });
  dispose = mount(document.body);
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  await Promise.resolve(); await Promise.resolve();
  const badge = document.querySelector<HTMLElement>('[data-verification]')!;
  expect(badge.dataset.state).toBe(state);
  expect(badge.textContent).toBe(label);
  expect(badge.querySelector('svg.icon')).toBeTruthy();
  expect(badge.getAttribute('role')).toBe('status');
  const detail = document.querySelector<HTMLElement>('[data-verification-detail]')!;
  expect(detail.hidden).toBe(state !== 'unavailable');
  if (state === 'unavailable') expect(detail.textContent).toBe('キー形式が不正です。');
  expect(document.querySelector('[data-warning]')!.textContent).toBe(state === 'match' ? '鍵長の警告' : '');
});
it('検証中はpending表示を出し、完了後に結果状態へ切り替える', async () => {
  let finish!: (result: Verification) => void;
  vi.mocked(verifySignature).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  dispose = mount(document.body);
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  const badge = document.querySelector<HTMLElement>('[data-verification]')!;
  expect(badge.dataset.state).toBe('pending');
  expect(badge.textContent).toBe('検証中…');
  expect(badge.querySelector('svg.icon')).toBeTruthy();
  finish({ state: 'mismatch', message: '署名不一致' });
  await Promise.resolve(); await Promise.resolve();
  expect(badge.dataset.state).toBe('mismatch');
  expect(badge.textContent).toBe('署名不一致');
});
it.each(['secret', 'public', 'jwt-alg', 'jwt-encoding', 'clear'])('%s変更時に古いバッジ・詳細・警告をまとめて消去する', async action => {
  vi.mocked(verifySignature).mockResolvedValue({ state: 'unavailable', message: '検証不可: 詳細理由', warning: '警告' });
  dispose = mount(document.body);
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-verification]')!.getAttribute('data-state')).toBe('unavailable');
  expect(document.querySelector('[data-verification-detail]')!.textContent).toBe('詳細理由');
  if (action === 'clear') document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  else if (action === 'jwt-alg' || action === 'jwt-encoding') {
    const select = document.getElementById(action) as HTMLSelectElement;
    select.selectedIndex = 1; select.dispatchEvent(new Event('change'));
  } else fill(action, 'changed');
  expect(document.querySelector('[data-verification]')!.getAttribute('data-state')).toBe('idle');
  expect(document.querySelector('[data-verification-detail]')!.hidden).toBe(true);
  expect(document.querySelector('[data-verification-detail]')!.textContent).toBe('');
  expect(document.querySelector('[data-warning]')!.textContent).toBe('');
});
it('デコード状態を検証状態と独立して表示し、変更時に警告と結果をリセットする', async () => {
  vi.mocked(verifySignature).mockResolvedValue({ state: 'match', message: '署名一致', warning: '警告' });
  dispose = mount(document.body);
  const decode = document.querySelector<HTMLElement>('[data-decode-state]')!;
  expect(decode.dataset.decodeState).toBe('success');
  expect(decode.textContent).toBe('デコード済み');
  document.querySelector<HTMLButtonElement>('[data-verify]')!.click();
  await Promise.resolve(); await Promise.resolve();
  expect(document.querySelector('[data-warning]')!.textContent).toBe('警告');
  fill('input', '!');
  expect(decode.dataset.decodeState).toBe('error');
  expect(decode.textContent).toBe('デコード失敗');
  expect(document.querySelector('[data-error]')!.textContent).not.toBe('');
  expect(document.querySelector('[data-verification]')!.getAttribute('data-state')).toBe('idle');
  expect(document.querySelector('[data-warning]')!.textContent).toBe('');
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(decode.dataset.decodeState).toBe('empty');
  expect(decode.textContent).toBe('未入力');
});
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
  for (const part of ['header', 'payload']) {
    for (const literal of ['1e-400', '9223372036854775807', '0.1234567890123456789012345', '-0']) {
      expect(field(part).value).toContain(literal);
    }
  }
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
  expect(field('signature').hasAttribute('readonly')).toBe(true);
  expect(document.querySelector('[data-bytes]')!.textContent).toBe('Signature: 32 バイト');
  expect(document.querySelector('[data-claims]')!.textContent).toContain('UTC');
  expect(document.querySelector('[data-claims]')!.textContent).toContain('JST');
  expect(field('alg').value).toBe('HS256'); expect(field('encoding').value).toBe('utf8');
  expect(field('secret').value).toBe(DEMO_SECRET); expect(field('secret').type).toBe('text');
  expect(document.querySelector('[data-reveal]')).toBeNull();
  expect(document.querySelector('[data-verification]')!.textContent).toBe('未検証');
  expect(verifySignature).not.toHaveBeenCalled();
  fill('input', token); expect(field('secret').value).toBe('');
});
it('端末時計に従って1秒ごとにNumericDateを再評価する', () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(999_000);
    dispose = mount(document.body);
    fill('input', `e30.${btoa('{"exp":1000}').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')}.`);
    expect(document.querySelector('[data-claims]')!.textContent).toContain('期限内');
    vi.advanceTimersByTime(1000);
    expect(document.querySelector('[data-claims]')!.textContent).toContain('期限切れ');
  } finally {
    dispose?.(); dispose = undefined; vi.useRealTimers(); document.body.replaceChildren();
  }
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
