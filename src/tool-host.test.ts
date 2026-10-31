import { describe, expect, it, vi } from 'vitest';
import type { ToolDefinition, ToolModule } from './registry';
import { createToolHost } from './tool-host';

function deferred() {
  let resolve!: (module: ToolModule) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<ToolModule>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function tool(id: string, load: ToolDefinition['load']): ToolDefinition {
  return { id, name: id, description: id, category: 'network', load };
}

describe('ツールのライフサイクル', () => {
  it('遅れて完了した旧importをマウントしない', async () => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    const old = deferred();
    const oldMount = vi.fn(() => vi.fn());
    const first = host.show(tool('a', () => old.promise));
    await host.show(tool('b', async () => ({ mount: (element) => {
      element.textContent = 'B';
      return vi.fn();
    } })));
    old.resolve({ mount: oldMount });
    expect(await first).toBe(false);
    expect(oldMount).not.toHaveBeenCalled();
    expect(container.textContent).toBe('B');
    expect(container.hasAttribute('aria-busy')).toBe(false);
  });

  it('切り替え時と終了時に各破棄関数を一度だけ呼ぶ', async () => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    const disposeA = vi.fn();
    const disposeB = vi.fn();
    await host.show(tool('a', async () => ({ mount: () => disposeA })));
    await host.show(tool('b', async () => ({ mount: () => {
      expect(disposeA).toHaveBeenCalledOnce();
      return disposeB;
    } })));
    host.destroy();
    host.destroy();
    expect(disposeA).toHaveBeenCalledOnce();
    expect(disposeB).toHaveBeenCalledOnce();
    expect(container.childElementCount).toBe(0);
  });

  it.each(['resolve', 'reject'] as const)('終了後のimportの%sを無視する', async (outcome) => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    const pending = deferred();
    const mount = vi.fn(() => vi.fn());
    const navigation = host.show(tool('a', () => pending.promise));
    host.destroy();
    if (outcome === 'resolve') pending.resolve({ mount });
    else pending.reject(new Error('offline'));
    expect(container.hasAttribute('aria-busy')).toBe(false);
    expect(await navigation).toBe(false);
    expect(mount).not.toHaveBeenCalled();
    expect(container.childElementCount).toBe(0);
    expect(container.hasAttribute('aria-busy')).toBe(false);
  });

  it.each(['resolve', 'reject'] as const)('旧importの%sでも新しいロード中状態を変更しない', async (outcome) => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    const old = deferred();
    const next = deferred();
    const first = host.show(tool('a', () => old.promise));
    const second = host.show(tool('b', () => next.promise));
    const oldMount = vi.fn(() => vi.fn());
    if (outcome === 'resolve') old.resolve({ mount: oldMount });
    else old.reject(new Error('offline'));
    expect(await first).toBe(false);
    expect(oldMount).not.toHaveBeenCalled();
    expect(container.querySelector('h1')?.textContent).toBe('b');
    expect(container.getAttribute('aria-busy')).toBe('true');
    next.resolve({ mount: () => vi.fn() });
    expect(await second).toBe(true);
    expect(container.hasAttribute('aria-busy')).toBe(false);
    host.destroy();
  });

  it('読み込み失敗を案内に変え、次のツールを表示できる', async () => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    await host.show(tool('a', () => Promise.reject(new Error('offline'))));
    expect(container.querySelector('h1')?.textContent).toBe('ツールを読み込めませんでした');
    expect(container.hasAttribute('aria-busy')).toBe(false);
    await host.show(tool('b', async () => ({ mount: (element) => {
      element.textContent = 'B';
      return vi.fn();
    } })));
    expect(container.textContent).toBe('B');
  });
});

it.each(['resolve', 'reject'] as const)('ホーム遷移後の旧importの%sを無視する', async (outcome) => {
  const container = document.createElement('div');
  const host = createToolHost(container);
  const pending = deferred();
  const mount = vi.fn(() => vi.fn());
  const navigation = host.show(tool('a', () => pending.promise));
  await host.show(null);
  if (outcome === 'resolve') pending.resolve({ mount });
  else pending.reject(new Error('offline'));
  expect(await navigation).toBe(false);
  expect(mount).not.toHaveBeenCalled();
  expect(container.querySelector('h1')?.textContent).toBe('Web Toolbox');
  expect(container.querySelectorAll('.tool-card')).toHaveLength(7);
  expect(container.hasAttribute('aria-busy')).toBe(false);
  host.destroy();
});

it('ホームに戻る際にツールを破棄し、空・未知のIDはエラーを表示する', async () => {
  const container = document.createElement('div');
  const host = createToolHost(container);
  const dispose = vi.fn();
  await host.show(tool('a', async () => ({ mount: () => dispose })));
  await host.show(null);
  expect(dispose).toHaveBeenCalledOnce();
  await host.show(undefined);
  expect(container.querySelector('h1')?.textContent).toBe('ツールが見つかりません');
  expect(container.querySelectorAll('.tool-card')).toHaveLength(0);
  host.destroy();
});

it.each(['resolve', 'reject'] as const)('新import失敗後の旧importの%sでエラー画面を上書きしない', async (outcome) => {
  const container = document.createElement('div');
  const host = createToolHost(container);
  const old = deferred();
  const next = deferred();
  const mount = vi.fn(() => vi.fn());
  const first = host.show(tool('a', () => old.promise));
  const second = host.show(tool('b', () => next.promise));
  next.reject(new Error('new failure'));
  expect(await second).toBe(true);
  const markup = container.innerHTML;
  expect(container.querySelector('h1')?.textContent).toBe('ツールを読み込めませんでした');
  if (outcome === 'resolve') old.resolve({ mount });
  else old.reject(new Error('old failure'));
  expect(await first).toBe(false);
  expect(mount).not.toHaveBeenCalled();
  expect(container.innerHTML).toBe(markup);
  expect(container.hasAttribute('aria-busy')).toBe(false);
  host.destroy();
});

it.each(['resolve', 'reject'] as const)('同一ツール連続選択で旧importの%sを無視し、最新mountだけを破棄する', async (outcome) => {
  const container = document.createElement('div');
  const host = createToolHost(container);
  const old = deferred();
  const next = deferred();
  const dispose = vi.fn();
  const oldMount = vi.fn(() => vi.fn());
  const mount = vi.fn((element: HTMLElement) => { element.textContent = 'latest'; return dispose; });
  const load = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const selected = tool('same', load);
  const first = host.show(selected);
  const second = host.show(selected);
  expect(load).toHaveBeenCalledTimes(2);
  next.resolve({ mount });
  expect(await second).toBe(true);
  if (outcome === 'resolve') old.resolve({ mount: oldMount });
  else old.reject(new Error('old failure'));
  expect(await first).toBe(false);
  expect(oldMount).not.toHaveBeenCalled();
  expect(mount).toHaveBeenCalledOnce();
  expect(container.textContent).toBe('latest');
  expect(container.hasAttribute('aria-busy')).toBe(false);
  expect(dispose).not.toHaveBeenCalled();
  host.destroy();
  host.destroy();
  expect(dispose).toHaveBeenCalledOnce();
});

it('表示済みの同一ツールを再選択すると以前のmountを一度だけ破棄する', async () => {
  const host = createToolHost(document.createElement('div'));
  const firstDispose = vi.fn();
  const nextDispose = vi.fn();
  const mount = vi.fn().mockReturnValueOnce(firstDispose).mockReturnValueOnce(nextDispose);
  const selected = tool('same', async () => ({ mount }));
  await host.show(selected);
  await host.show(selected);
  expect(mount).toHaveBeenCalledTimes(2);
  expect(firstDispose).toHaveBeenCalledOnce();
  expect(nextDispose).not.toHaveBeenCalled();
  host.destroy();
  host.destroy();
  expect(firstDispose).toHaveBeenCalledOnce();
  expect(nextDispose).toHaveBeenCalledOnce();
});

it('遷移操作の一時入力をマウントに渡す', async () => {
  const container = document.createElement('div');
  const host = createToolHost(container);
  const mount = vi.fn(() => vi.fn());
  await host.show({ id: 'rdap-lookup', name: 'RDAP', description: '', category: 'network', load: async () => ({ mount }) }, '8.8.8.8');
  expect(mount).toHaveBeenCalledWith(container, '8.8.8.8');
  host.destroy();
});
