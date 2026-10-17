import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { setupTheme } from './theme';

describe('テーマ設定', () => {
  let media: MediaQueryList;
  let select: HTMLSelectElement;
  let stop: () => void;

  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    media = Object.assign(new EventTarget(), { matches: true }) as MediaQueryList;
    vi.stubGlobal('matchMedia', vi.fn(() => media));
    select = document.createElement('select');
    select.innerHTML = '<option>system</option><option>light</option><option>dark</option>';
  });
  afterEach(() => { stop?.(); vi.unstubAllGlobals(); });

  function choose(value: string) {
    select.value = value;
    select.dispatchEvent(new Event('change'));
  }
  function osTheme(dark: boolean) {
    Object.defineProperty(media, 'matches', { value: dark, configurable: true });
    media.dispatchEvent(new Event('change'));
  }

  it('未指定時はOS設定に追従し、保存しない', () => {
    stop = setupTheme(select);
    expect(document.documentElement.dataset.theme).toBe('dark');
    osTheme(false);
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(localStorage.length).toBe(0);
  });

  it('初期スクリプトが復元した手動設定を維持する', () => {
    document.documentElement.dataset.theme = 'light';
    stop = setupTheme(select);
    expect(select.value).toBe('light');
    osTheme(true);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('手動選択のみ保存し、システムに戻すと設定を削除する', () => {
    stop = setupTheme(select);
    choose('light');
    expect(localStorage.getItem('web-toolbox-theme')).toBe('light');
    osTheme(true);
    expect(document.documentElement.dataset.theme).toBe('light');
    choose('system');
    expect(localStorage.getItem('web-toolbox-theme')).toBeNull();
    expect(document.documentElement.dataset.theme).toBe('dark');
    osTheme(false);
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('localStorageが使えなくても手動選択とOS追従が動く', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'removeItem').mockImplementation(() => { throw new Error('denied'); });
    stop = setupTheme(select);
    expect(() => choose('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
    expect(() => choose('system')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('dark');
  });

  it('終了時に購読を解放する', () => {
    const remove = vi.spyOn(media, 'removeEventListener');
    stop = setupTheme(select);
    stop();
    osTheme(false);
    expect(remove).toHaveBeenCalledWith('change', expect.any(Function));
    expect(document.documentElement.dataset.theme).toBe('dark');
  });
});
