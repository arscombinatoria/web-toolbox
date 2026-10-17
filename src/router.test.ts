import { afterEach, expect, it, vi } from 'vitest';
import { homeUrl, startRouter, toolIdFromUrl, toolUrl } from './router';
import { findTool, tools } from './registry';

let stop: (() => void) | undefined;
afterEach(() => { stop?.(); document.body.replaceChildren(); history.replaceState(null, '', '/'); });

it.each(['tool', 'home'])('%sリンクの修飾キー・別タブ・ダウンロード・右クリックのリンク操作を横取りしない', (kind) => {
  const navigate = vi.fn();
  stop = startRouter(navigate);
  navigate.mockClear();
  const link = document.createElement('a');
  if (kind === 'home') link.dataset.home = '';
  else link.dataset.toolId = 'datetime';
  link.href = kind === 'home' ? './' : '?tool=datetime';
  document.body.append(link);
  const cases = [
    { ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 },
  ];
  for (const options of cases) {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, ...options });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
  }
  for (const [attribute, value] of [['target', '_blank'], ['download', 'file']] as const) {
    link.setAttribute(attribute, value);
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    link.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    link.removeAttribute(attribute);
  }
  expect(navigate).not.toHaveBeenCalled();
});

it('tool未指定だけをホームとし、既知・未知・空のIDを維持する', () => {
  expect(toolIdFromUrl(new URL('https://example.com/web-toolbox/?keep=yes'))).toBeNull();
  for (const tool of tools) {
    const id = toolIdFromUrl(toolUrl(tool.id, new URL('https://example.com/web-toolbox/')));
    expect(id).toBe(tool.id);
    expect(findTool(id!)).toBe(tool);
  }
  for (const id of ['', 'unknown']) {
    expect(toolIdFromUrl(new URL(`https://example.com/web-toolbox/?tool=${id}`))).toBe(id);
    expect(findTool(id)).toBeUndefined();
  }
});

it('ホームURLはtoolだけを全て削除し、サブパス・他のクエリ・ハッシュを保持する', () => {
  const current = new URL('https://example.com/web-toolbox/?keep=yes&tool=datetime&tag=a&tag=b&tool=unknown#section');
  expect(homeUrl(current).href).toBe('https://example.com/web-toolbox/?keep=yes&tag=a&tag=b#section');
  expect(current.searchParams.get('tool')).toBe('datetime');
  expect(toolUrl('ip-address', homeUrl(current)).href).toBe('https://example.com/web-toolbox/?keep=yes&tag=a&tag=b&tool=ip-address#section');
});

it('ホームの初回表示・History APIによる往復・popstateを通知する', () => {
  history.replaceState(null, '', '/web-toolbox/?keep=yes');
  const navigate = vi.fn();
  stop = startRouter(navigate);
  expect(navigate).toHaveBeenLastCalledWith(null, false);
  const link = document.createElement('a');
  link.dataset.home = '';
  link.href = homeUrl().href;
  document.body.append(link);
  history.replaceState(null, '', toolUrl('datetime'));
  const push = vi.spyOn(history, 'pushState');
  link.click();
  expect(navigate).toHaveBeenLastCalledWith(null, true);
  expect(location.search).toBe('?keep=yes');
  link.click();
  expect(push).toHaveBeenCalledOnce();
  history.replaceState(null, '', '?tool=datetime');
  window.dispatchEvent(new PopStateEvent('popstate'));
  expect(navigate).toHaveBeenLastCalledWith('datetime', true);
  push.mockRestore();
});
