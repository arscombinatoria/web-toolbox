import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLayout } from './layout';

describe('レイアウトの状態とライフサイクル', () => {
  let media: MediaQueryList;
  let root: HTMLElement;
  let layout: ReturnType<typeof createLayout>;
  let dialog: HTMLDialogElement;
  let menu: HTMLButtonElement;
  let sidebar: HTMLElement;

  beforeEach(() => {
    history.replaceState(null, '', '/web-toolbox/?keep=first');
    media = Object.assign(new EventTarget(), { matches: true }) as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    root = document.createElement('div');
    document.body.append(root);
    layout = createLayout(root);
    dialog = root.querySelector('dialog')!;
    // jsdom未実装のAPIだけを補い、ネイティブなフォーカス復帰はPlaywrightで検証する。
    dialog.showModal = () => { dialog.open = true; };
    dialog.close = () => {
      if (!dialog.open) return;
      dialog.open = false;
      dialog.dispatchEvent(new Event('close'));
    };
    menu = root.querySelector('.menu-button')!;
    sidebar = root.querySelector('aside')!;
  });

  afterEach(() => {
    layout.destroy();
    root.remove();
    history.replaceState(null, '', '/');
    vi.unstubAllGlobals();
  });

  function resize(matches: boolean) {
    Object.defineProperty(media, 'matches', { value: matches, configurable: true });
    media.dispatchEvent(new Event('change'));
  }

  it('選択のたびに現在のクエリとハッシュをリンクへ反映し、選択状態を置き換える', () => {
    layout.select('datetime');
    expect(root.querySelector('[aria-current]')?.getAttribute('data-tool-id')).toBe('datetime');
    history.replaceState(null, '', '/web-toolbox/?keep=next&tool=datetime#section');
    layout.select(null);
    expect(root.querySelectorAll('[aria-current]')).toHaveLength(1);
    expect(root.querySelector('[aria-current]')?.hasAttribute('data-home')).toBe(true);
    expect(root.querySelector<HTMLElement>('.content-heading')!.hidden).toBe(true);
    for (const link of root.querySelectorAll<HTMLAnchorElement>('a[data-home], a[data-tool-id]')) {
      const url = new URL(link.href);
      expect(url.pathname).toBe('/web-toolbox/');
      expect(url.searchParams.get('keep')).toBe('next');
      expect(url.hash).toBe('#section');
      expect(url.searchParams.get('tool')).toBe(link.dataset.toolId ?? null);
    }
    layout.select('unknown');
    expect(root.querySelectorAll('[aria-current]')).toHaveLength(0);
    expect(root.querySelector<HTMLElement>('.content-heading')!.hidden).toBe(false);
  });

  it('不正IDで選択リンクがない場合も閉じるボタンへフォーカスする', () => {
    layout.select('unknown');
    expect(sidebar.hidden).toBe(true);
    menu.click();
    expect(dialog.open).toBe(true);
    expect(sidebar.parentElement).toBe(dialog);
    expect(sidebar.hidden).toBe(false);
    expect(menu.getAttribute('aria-expanded')).toBe('true');
    expect(document.activeElement).toBe(dialog.querySelector('.close-menu'));
  });

  it.each(['button', 'backdrop', 'selection'])('%s による閉鎖後にサイドバーを収納する', source => {
    layout.select(null);
    menu.click();
    sidebar.querySelector('h2')!.click();
    expect(dialog.open).toBe(true);
    if (source === 'button') dialog.querySelector<HTMLButtonElement>('.close-menu')!.click();
    else if (source === 'backdrop') dialog.click();
    else layout.select('datetime');
    expect(dialog.open).toBe(false);
    expect(sidebar.parentElement).toBe(root.querySelector('.sidebar-slot'));
    expect(sidebar.hidden).toBe(true);
    expect(menu.getAttribute('aria-expanded')).toBe('false');
  });

  it('開いたメニューをデスクトップへの変更で閉じ、モバイルへ戻ると隠す', () => {
    menu.click();
    resize(false);
    expect(dialog.open).toBe(false);
    expect(sidebar.hidden).toBe(false);
    expect(sidebar.parentElement).toBe(root.querySelector('.sidebar-slot'));
    expect(menu.getAttribute('aria-expanded')).toBe('false');
    resize(true);
    expect(sidebar.hidden).toBe(true);
    expect(dialog.open).toBe(false);
  });

  it.each([false, true])('destroyは購読を解除し、後続イベントでDOMを更新しない（open=%s）', open => {
    const removeMedia = vi.spyOn(media, 'removeEventListener');
    const removeDialog = vi.spyOn(dialog, 'removeEventListener');
    if (open) menu.click();
    layout.destroy();
    expect(removeMedia).toHaveBeenCalledWith('change', expect.any(Function));
    expect(removeDialog).toHaveBeenCalledWith('close', expect.any(Function));
    expect(dialog.open).toBe(false);
    expect(root.childElementCount).toBe(0);
    // 保持した旧DOMも更新されないことを確認し、空のrootだけの検証にしない。
    const parent = sidebar.parentElement;
    const hidden = sidebar.hidden;
    const expanded = menu.getAttribute('aria-expanded');
    resize(!hidden);
    dialog.dispatchEvent(new Event('close'));
    expect(sidebar.parentElement).toBe(parent);
    expect(sidebar.hidden).toBe(hidden);
    expect(menu.getAttribute('aria-expanded')).toBe(expanded);
    expect(root.childElementCount).toBe(0);
  });
});
