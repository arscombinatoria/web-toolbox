import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';
import { generateXlsx } from './xlsx';

vi.mock('./xlsx', () => ({ generateXlsx: vi.fn() }));
afterEach(() => { document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals(); });
function setup() {
  const dispose = mount(document.body);
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  const fill = (text: string) => { input.value = text; input.dispatchEvent(new Event('input')); };
  fill('h\n---\nx');
  const download = document.querySelector<HTMLButtonElement>('[data-download]')!;
  return { dispose, fill, download };
}

it('生成中の入力変更・破棄後はダウンロードしない', async () => {
  let finish!: (bytes: Uint8Array<ArrayBuffer>) => void;
  vi.mocked(generateXlsx).mockImplementation(() => new Promise(resolve => { finish = resolve; }));
  const create = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  const { dispose, fill, download } = setup();
  download.click();
  await vi.waitFor(() => expect(finish).toBeDefined());
  fill('h\n---\ny');
  finish(new Uint8Array());
  await vi.waitFor(() => expect(download.disabled).toBe(false));
  expect(create).not.toHaveBeenCalled();
  download.click();
  await vi.waitFor(() => expect(generateXlsx).toHaveBeenCalledTimes(2));
  dispose(); finish(new Uint8Array());
  await Promise.resolve();
  expect(create).not.toHaveBeenCalled();
});

it('Object URLを破棄時に解放し、生成失敗を通知する', async () => {
  vi.mocked(generateXlsx).mockResolvedValue(new Uint8Array());
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:test', revokeObjectURL: revoke });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const { dispose, download } = setup();
  download.click();
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('ダウンロードしました'));
  dispose();
  expect(revoke).toHaveBeenCalledWith('blob:test');
  vi.mocked(generateXlsx).mockRejectedValue(new Error('生成エラー'));
  const next = setup(); next.download.click();
  await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('生成エラー'));
  expect(next.download.disabled).toBe(false);
  next.dispose();
});
