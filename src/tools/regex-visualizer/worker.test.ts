import { expect, it, vi } from 'vitest';
import type { DiagramRequest } from './protocol';

it('Workerは構文エラーと成功をリクエストID付きで返す', async () => {
  const post = vi.fn();
  vi.stubGlobal('postMessage', post); vi.stubGlobal('onmessage', null);
  try {
    await import('./worker');
    const scope = globalThis as unknown as { onmessage: (event: MessageEvent<DiagramRequest>) => void };
    scope.onmessage(new MessageEvent('message', { data: { id: 42, pattern: '(?<n>a)\\k<n>', flags: 'u' } }));
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ id: 42, ok: true, svg: expect.stringContaining('<svg') }));
    scope.onmessage(new MessageEvent('message', { data: { id: 43, pattern: '(', flags: '' } }));
    expect(post).toHaveBeenLastCalledWith(expect.objectContaining({ id: 43, ok: false, kind: 'syntax' }));
  } finally { vi.unstubAllGlobals(); }
});
