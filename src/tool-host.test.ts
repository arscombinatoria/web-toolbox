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

  it('終了後のimport完了を無視する', async () => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    const pending = deferred();
    const mount = vi.fn(() => vi.fn());
    const navigation = host.show(tool('a', () => pending.promise));
    host.destroy();
    pending.resolve({ mount });
    expect(await navigation).toBe(false);
    expect(mount).not.toHaveBeenCalled();
  });

  it('旧importの失敗でも新しいロード中状態を変更しない', async () => {
    const container = document.createElement('div');
    const host = createToolHost(container);
    const old = deferred();
    const next = deferred();
    const first = host.show(tool('a', () => old.promise));
    const second = host.show(tool('b', () => next.promise));
    old.reject(new Error('offline'));
    await first;
    expect(container.querySelector('h1')?.textContent).toBe('b');
    expect(container.getAttribute('aria-busy')).toBe('true');
    next.resolve({ mount: () => vi.fn() });
    await second;
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
  expect(container.querySelectorAll('.tool-card')).toHaveLength(4);
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
