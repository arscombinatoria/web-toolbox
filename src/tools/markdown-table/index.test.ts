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

it('初期サンプルを変換してコピーとダウンロードを有効にする', () => {
  const dispose = mount(document.body);
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  const output = document.querySelector<HTMLTextAreaElement>('#table-output')!;
  expect(input.value).toBe('| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 3 | 青森県産 |\n| みかん | 5 | 愛媛県産 |');
  expect(output.value).toBe('品名\t数量\t備考\nりんご\t3\t青森県産\nみかん\t5\t愛媛県産');
  expect(document.querySelector<HTMLButtonElement>('[data-copy]')!.disabled).toBe(false);
  expect(document.querySelector<HTMLButtonElement>('[data-download]')!.disabled).toBe(false);
  dispose();
});

it('方向切り替えは変換結果を渡し、空・エラー時は入力を保持する', () => {
  const dispose = mount(document.body);
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  const output = document.querySelector<HTMLTextAreaElement>('#table-output')!;
  const direction = (value: 'excel' | 'markdown') => {
    const radio = document.querySelector<HTMLInputElement>(`[name="table-direction"][value="${value}"]`)!;
    radio.checked = true;
    radio.dispatchEvent(new Event('change'));
  };

  direction('markdown');
  expect(input.value).toBe('品名\t数量\t備考\nりんご\t3\t青森県産\nみかん\t5\t愛媛県産');
  expect(output.value).toBe('| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 3 | 青森県産 |\n| みかん | 5 | 愛媛県産 |');
  direction('excel');
  expect(input.value).toBe('| 品名 | 数量 | 備考 |\n| --- | --- | --- |\n| りんご | 3 | 青森県産 |\n| みかん | 5 | 愛媛県産 |');

  input.value = ''; input.dispatchEvent(new Event('input'));
  direction('markdown');
  expect(input.value).toBe('');
  expect(output.value).toBe('');
  expect(document.querySelector<HTMLButtonElement>('[data-copy]')!.disabled).toBe(true);

  input.value = '"unclosed'; input.dispatchEvent(new Event('input'));
  direction('excel');
  expect(input.value).toBe('"unclosed');
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('ヘッダー');
  expect(document.querySelector<HTMLButtonElement>('[data-copy]')!.disabled).toBe(true);

  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  direction('markdown');
  expect(input.value).toBe('');
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('');
  dispose();
});

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

for (const outcome of ['resolve', 'reject'] as const) {
  it.each(['edit', 'dispose'] as const)('コピーの' + outcome + 'が%s後の状態を上書きしない', async change => {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const pending = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
    const write = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText: write } });
    const { dispose, fill } = setup();
    const copy = document.querySelector<HTMLButtonElement>('[data-copy]')!;
    const status = document.querySelector<HTMLElement>('[role="status"]')!;
    try {
      copy.click();
      expect(copy.disabled).toBe(true);
      copy.click();
      expect(write).toHaveBeenCalledExactlyOnceWith('h\r\nx');
      if (change === 'edit') fill('h\n---\ny');
      else dispose();
      if (outcome === 'resolve') resolve();
      else reject(new Error('clipboard denied'));
      await pending.catch(() => {});
      expect(status.textContent).toBe('');
      if (change === 'edit') {
        expect(copy.disabled).toBe(false);
        copy.click();
        await vi.waitFor(() => expect(status.textContent).toBe('コピーしました。'));
        expect(write).toHaveBeenLastCalledWith('h\r\ny');
      } else {
        copy.dispatchEvent(new MouseEvent('click'));
        expect(write).toHaveBeenCalledTimes(1);
      }
    } finally {
      dispose();
    }
  });
}

it.each(['edit', 'dispose'] as const)('古いXLSX生成の失敗を%s後に通知しない', async change => {
  let reject!: (error: Error) => void;
  const pending = new Promise<Uint8Array<ArrayBuffer>>((_, no) => { reject = no; });
  const generate = vi.mocked(generateXlsx).mockReset().mockReturnValue(pending);
  const { dispose, fill, download } = setup();
  const status = document.querySelector<HTMLElement>('[role="status"]')!;
  try {
    download.click();
    await vi.waitFor(() => expect(generate).toHaveBeenCalledOnce());
    if (change === 'edit') fill('h\n---\ny');
    else dispose();
    const previous = status.textContent;
    reject(new Error('古い生成エラー'));
    await pending.catch(() => {});
    expect(status.textContent).toBe(previous);
    if (change === 'edit') expect(download.disabled).toBe(false);
    else {
      download.dispatchEvent(new MouseEvent('click'));
      expect(generate).toHaveBeenCalledOnce();
    }
  } finally {
    dispose();
  }
});

it('ダウンロード用Object URLをタイマーで一度だけ解放する', async () => {
  vi.useFakeTimers();
  vi.mocked(generateXlsx).mockResolvedValue(new Uint8Array());
  const revoke = vi.fn();
  vi.stubGlobal('URL', { createObjectURL: () => 'blob:timer', revokeObjectURL: revoke });
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  const { dispose, download } = setup();
  try {
    download.click();
    await vi.waitFor(() => expect(document.querySelector('[role="status"]')?.textContent).toContain('ダウンロードしました'));
    expect(revoke).not.toHaveBeenCalled();
    expect(document.querySelector('a[download]')).toBeNull();
    await vi.runAllTimersAsync();
    expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:timer');
    dispose();
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    dispose();
  }
});
