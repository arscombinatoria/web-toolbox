// @vitest-environment jsdom
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

it.each(['settings', 'direction', 'input'] as const)('コピー保留中の%s変更後は最新の生成文字列だけを通知・コピーする', async change => {
  let resolve!: () => void;
  const pending = new Promise<void>(done => { resolve = done; });
  const write = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText: write } });
  const dispose = mount(document.body);
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  const output = document.querySelector<HTMLTextAreaElement>('#table-output')!;
  const copy = document.querySelector<HTMLButtonElement>('[data-copy]')!;
  const status = document.querySelector<HTMLElement>('[role="status"]')!;
  try {
    if (change === 'settings') {
      const direction = document.querySelector<HTMLInputElement>('[value="markdown"]')!;
      direction.checked = true; direction.dispatchEvent(new Event('change'));
      const alignment = document.querySelector<HTMLSelectElement>('[data-column="0"]')!;
      alignment.focus();
      copy.click();
      alignment.value = 'right'; alignment.dispatchEvent(new Event('change', { bubbles: true }));
      expect(alignment.isConnected).toBe(true);
      expect(document.activeElement).toBe(alignment);
    } else {
      copy.click();
      if (change === 'direction') {
        const direction = document.querySelector<HTMLInputElement>('[value="markdown"]')!;
        direction.checked = true; direction.dispatchEvent(new Event('change'));
      } else {
        input.value = 'h\n---\ny'; input.dispatchEvent(new Event('input'));
      }
    }
    expect(write).toHaveBeenCalledTimes(1);
    resolve();
    await pending;
    await vi.waitFor(() => expect(copy.disabled).toBe(false));
    expect(status.textContent).toBe('');
    const expected = document.querySelector<HTMLInputElement>('[value="excel"]')!.checked ? 'h\r\ny' : output.value;
    copy.click();
    await vi.waitFor(() => expect(status.textContent).toBe('コピーしました。'));
    expect(write).toHaveBeenLastCalledWith(expected);
  } finally {
    dispose();
  }
});

it('クリアでは配置だけ初期化し、パディングは維持し、離脱後は全設定を破棄する', () => {
  const dispose = mount(document.body);
  const direction = document.querySelector<HTMLInputElement>('[value="markdown"]')!;
  direction.checked = true; direction.dispatchEvent(new Event('change'));
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  input.value = 'h\tx\na\tb'; input.dispatchEvent(new Event('input'));
  const alignment = document.querySelector<HTMLSelectElement>('[data-column="0"]')!;
  alignment.value = 'center'; alignment.dispatchEvent(new Event('change', { bubbles: true }));
  const padding = document.querySelector<HTMLInputElement>('[data-padding]')!;
  padding.checked = true; padding.dispatchEvent(new Event('change'));
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(document.querySelectorAll('[data-column]')).toHaveLength(0);
  expect(padding.checked).toBe(true);
  dispose();

  const nextDispose = mount(document.body);
  expect(document.querySelector<HTMLInputElement>('[data-padding]')!.checked).toBe(false);
  expect(document.querySelector<HTMLInputElement>('[value="excel"]')!.checked).toBe(true);
  nextDispose();
});

function selectDirection(direction: 'excel' | 'markdown') {
  const radio = document.querySelector<HTMLInputElement>(`[name="table-direction"][value="${direction}"]`)!;
  radio.checked = true;
  radio.dispatchEvent(new Event('change'));
}

function fillTsv(headers: readonly string[]) {
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  input.value = `${headers.join('\t')}\n${headers.map(() => 'x').join('\t')}`;
  input.dispatchEvent(new Event('input'));
}

it('配置は50列まで表示し、51列でページ移動・フォーカス・出力変更できる', () => {
  const dispose = mount(document.body);
  selectDirection('markdown');
  const headers50 = Array.from({ length: 50 }, (_, index) => `h${index}`);
  fillTsv(headers50);
  expect(document.querySelectorAll('[data-column]')).toHaveLength(50);
  expect(document.querySelector('[data-alignment-pagination]')!.hasAttribute('hidden')).toBe(true);

  fillTsv([...headers50, 'last']);
  expect(document.querySelectorAll('[data-column]')).toHaveLength(50);
  expect(document.querySelector('[data-alignment-range]')!.textContent).toBe('列 1〜50 を表示中（全 51 列）');
  const next = document.querySelector<HTMLButtonElement>('[data-next-page]')!;
  expect(next.disabled).toBe(false);
  next.focus(); next.click();
  const last = document.querySelector<HTMLSelectElement>('[data-column="50"]')!;
  expect(document.querySelectorAll('[data-column]')).toHaveLength(1);
  expect(last.getAttribute('aria-label')).toBe('列51（last）の配置');
  last.value = 'right'; last.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.activeElement).toBe(last);
  expect(document.querySelector<HTMLTextAreaElement>('#table-output')!.value).toContain('---:');
  const previous = document.querySelector<HTMLButtonElement>('[data-previous-page]')!;
  previous.click();
  expect(document.querySelectorAll('[data-column]')).toHaveLength(50);
  expect(document.querySelector<HTMLSelectElement>('[data-column="0"]')!.getAttribute('aria-label'))
    .toBe('列1（h0）の配置');
  expect(document.querySelector<HTMLTextAreaElement>('#table-output')!.value).toContain('---:');
  dispose();
});

it('最大列数でも配置DOMを50件に制限し、末尾設定・入力エラー・列数減少でページを整える', async () => {
  const dispose = mount(document.body);
  selectDirection('markdown');
  const headers = Array.from({ length: 16_384 }, (_, index) => `h${index}`);
  fillTsv(headers);
  expect(document.querySelectorAll('[data-column]')).toHaveLength(50);
  expect(document.querySelectorAll('[data-alignments] label')).toHaveLength(50);
  expect(document.querySelectorAll('[data-alignments] select')).toHaveLength(50);
  expect(document.querySelectorAll('[data-alignments] option')).toHaveLength(200);
  const next = document.querySelector<HTMLButtonElement>('[data-next-page]')!;
  next.click();
  const column51 = document.querySelector<HTMLSelectElement>('[data-column="50"]')!;
  column51.value = 'right'; column51.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector<HTMLTextAreaElement>('#table-output')!.value).toContain('---:');
  document.querySelector<HTMLButtonElement>('[data-previous-page]')!.click();
  for (let page = 1; page < Math.ceil(headers.length / 50); page++) next.click();
  expect(document.querySelector('[data-alignment-range]')!.textContent)
    .toBe('列 16,351〜16,384 を表示中（全 16,384 列）');
  expect(document.querySelectorAll('[data-column]')).toHaveLength(34);
  const last = document.querySelector<HTMLSelectElement>('[data-column="16383"]')!;
  last.value = 'center'; last.dispatchEvent(new Event('change', { bubbles: true }));
  const output = document.querySelector<HTMLTextAreaElement>('#table-output')!;
  expect(output.value).toContain('h16383');
  expect(output.value).toContain(':---:');
  const copy = document.querySelector<HTMLButtonElement>('[data-copy]')!;
  expect(copy.disabled).toBe(false);
  const writeText = vi.fn().mockResolvedValue(undefined);
  vi.stubGlobal('navigator', { clipboard: { writeText } });
  copy.click();
  await vi.waitFor(() => expect(writeText).toHaveBeenCalledExactlyOnceWith(output.value));

  fillTsv(headers.slice(0, 10_001));
  expect(document.querySelector('[data-alignment-range]')!.textContent)
    .toBe('列 10,001〜10,001 を表示中（全 10,001 列）');
  expect(document.querySelectorAll('[data-column]')).toHaveLength(1);
  expect(document.querySelector<HTMLTextAreaElement>('#table-output')!.value).not.toContain(':---:');
  expect(document.querySelector<HTMLButtonElement>('[data-copy]')!.disabled).toBe(false);
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  input.value = 'bad\t"unterminated'; input.dispatchEvent(new Event('input'));
  expect(document.querySelector('[role="alert"]')!.textContent).not.toBe('');
  expect(document.querySelector('[data-alignment-range]')!.hasAttribute('hidden')).toBe(false);
  fillTsv(headers.slice(0, 51));
  expect(document.querySelector('[data-alignment-range]')!.textContent)
    .toBe('列 51〜51 を表示中（全 51 列）');
  expect(document.querySelector<HTMLSelectElement>('[data-column="50"]')!.value).toBe('right');
  fillTsv(headers);
  next.click();
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(document.querySelector('[data-alignment-range]')!.hasAttribute('hidden')).toBe(true);
  selectDirection('excel');
  selectDirection('markdown');
  fillTsv(headers.slice(0, 51));
  expect(document.querySelector('[data-alignment-range]')!.textContent)
    .toBe('列 1〜50 を表示中（全 51 列）');
  dispose();
});

it('重複・空ヘッダーの名前と配置を保ち、設定更新後も入力エラーを復帰できる', () => {
  const dispose = mount(document.body);
  selectDirection('markdown');
  fillTsv(['same', '', 'same']);
  const second = document.querySelector<HTMLSelectElement>('[data-column="1"]')!;
  const third = document.querySelector<HTMLSelectElement>('[data-column="2"]')!;
  expect(second.getAttribute('aria-label')).toBe('列2（空のヘッダー）の配置');
  expect(third.getAttribute('aria-label')).toBe('列3（same）の配置');
  second.value = 'center'; second.dispatchEvent(new Event('change', { bubbles: true }));
  third.value = 'right'; third.dispatchEvent(new Event('change', { bubbles: true }));
  fillTsv(['same', '', 'same', 'new']);
  expect(document.querySelector<HTMLSelectElement>('[data-column="1"]')!.value).toBe('center');
  expect(document.querySelector<HTMLSelectElement>('[data-column="2"]')!.value).toBe('right');
  expect(document.querySelector<HTMLSelectElement>('[data-column="3"]')!.value).toBe('none');
  fillTsv(['same', '', '']);
  expect(document.querySelectorAll('[data-column]')).toHaveLength(3);
  expect(document.querySelector<HTMLSelectElement>('[data-column="1"]')!.value).toBe('center');
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  input.value = 'same\t"unterminated'; input.dispatchEvent(new Event('input'));
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('引用符');
  const alignment = document.querySelector<HTMLSelectElement>('[data-column="1"]')!;
  alignment.value = 'left'; alignment.dispatchEvent(new Event('change', { bubbles: true }));
  expect(document.querySelector('[role="alert"]')!.textContent).toContain('引用符');
  expect(document.querySelector<HTMLTextAreaElement>('#table-output')!.value).toBe('');
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(document.querySelectorAll('[data-column]')).toHaveLength(0);
  expect(document.querySelector('[role="alert"]')!.textContent).toBe('');
  expect(document.querySelector('[data-alignment-range]')!.hasAttribute('hidden')).toBe(true);
  dispose();
});

it('列配置と幅揃えを出力へ反映し、配置変更・方向切り替え・クリア後の状態を保つ', () => {
  const dispose = mount(document.body);
  selectDirection('markdown');
  const input = document.querySelector<HTMLTextAreaElement>('#table-input')!;
  input.value = 'left\tcenter\tright\tnone\nh\tlong\tx\tz'; input.dispatchEvent(new Event('input'));
  for (const [index, alignment] of ['left', 'center', 'right', 'none'].entries()) {
    const select = document.querySelector<HTMLSelectElement>(`[data-column="${index}"]`)!;
    select.value = alignment;
    select.dispatchEvent(new Event('change', { bubbles: true }));
  }
  const output = document.querySelector<HTMLTextAreaElement>('#table-output')!;
  expect(output.value).toContain('| :--- | :---: | ---: | --- |');
  const padding = document.querySelector<HTMLInputElement>('[data-padding]')!;
  const warning = document.querySelector<HTMLElement>('[data-padding-warning]')!;
  expect(padding.checked).toBe(false);
  expect(warning.hasAttribute('hidden')).toBe(true);
  padding.checked = true; padding.dispatchEvent(new Event('change'));
  expect(warning.hasAttribute('hidden')).toBe(false);
  expect(warning.textContent).toBe('列幅調整用の空白が追加されます。Excelへ再変換する際に、追加された空白がセルの内容として残る場合があります。');
  expect(output.value).toBe('| left | center | right | none |\n| :--- | :----: | ----: | ---- |\n| h    |  long  |     x | z    |');
  const padded = output.value;
  selectDirection('excel');
  expect(input.value).toBe(padded);
  expect(output.value).toBe('left\tcenter\tright\tnone\nh   \t long \t    x\tz   ');
  selectDirection('markdown');
  expect(output.value).toBe(padded);
  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(padding.checked).toBe(true);
  expect(document.querySelector('[data-format-options]')!.hasAttribute('hidden')).toBe(false);
  expect(output.value).toBe('');
  dispose();
});
