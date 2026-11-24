import { afterEach, expect, it, vi } from 'vitest';
import { mount } from './index';

let dispose: (() => void) | undefined;
afterEach(() => { dispose?.(); document.body.replaceChildren(); vi.restoreAllMocks(); });

it.each(['resolve', 'reject'])('コピー%sが破棄後のDOMを変更せず、イベントも解除する', async (mode) => {
  let resolve!: () => void;
  let reject!: (error: Error) => void;
  const writeText = vi.fn(() => new Promise<void>((res, rej) => { resolve = res; reject = rej; }));
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  dispose = mount(document.body);
  const view = document.querySelector<HTMLElement>('.width-tool')!;
  const input = view.querySelector<HTMLTextAreaElement>('#width-input')!;
  const output = view.querySelector<HTMLTextAreaElement>('#width-output')!;
  const copy = view.querySelector<HTMLButtonElement>('[data-copy]')!;
  input.value = 'Ａ';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  copy.click();
  expect(writeText).toHaveBeenCalledWith('A');
  dispose();
  const markup = view.innerHTML;
  if (mode === 'resolve') resolve();
  else reject(new Error('denied'));
  await Promise.resolve();
  expect(view.innerHTML).toBe(markup);
  expect(copy.disabled).toBe(true);
  input.value = 'Ｂ';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(output.value).toBe('A');
  copy.dispatchEvent(new Event('click'));
  expect(writeText).toHaveBeenCalledTimes(1);
  expect(document.body.childElementCount).toBe(0);
});

it('カウンター、入れ替え、IME抑止、保留中コピー通知を同期する', async () => {
  let finishCopy!: () => void;
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: () => new Promise<void>(resolve => { finishCopy = resolve; }),
  } });
  dispose = mount(document.body);
  const input = document.querySelector<HTMLTextAreaElement>('#width-input')!;
  const output = document.querySelector<HTMLTextAreaElement>('#width-output')!;
  const swap = document.querySelector<HTMLButtonElement>('[data-swap]')!;
  const inputCount = document.querySelector<HTMLElement>('#width-input-count')!;
  const outputCount = document.querySelector<HTMLElement>('#width-output-count')!;
  const status = document.querySelector<HTMLElement>('[role="status"]')!;
  const copy = document.querySelector<HTMLButtonElement>('[data-copy]')!;
  const direction = document.querySelector<HTMLInputElement>('[value="to-full"]')!;
  const katakana = document.querySelector<HTMLInputElement>('[name="katakana"]')!;
  expect(input.getAttribute('aria-describedby')?.split(' ')).toEqual(['width-input-count', 'width-privacy']);
  expect(output.getAttribute('aria-describedby')?.split(' ')).toEqual(['width-output-count', 'width-copy-help']);
  expect(inputCount.hasAttribute('aria-live')).toBe(false);
  expect(outputCount.hasAttribute('aria-live')).toBe(false);
  expect(inputCount.textContent).toBe('0文字 / 0行');
  expect(outputCount.textContent).toBe('0文字 / 0行');
  expect(swap.disabled).toBe(true);

  input.value = 'ｶﾞ😀\n';
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
  expect(inputCount.textContent).toBe('4文字 / 2行');
  expect(output.value).toBe('ｶﾞ😀\n');
  expect(swap.disabled).toBe(false);
  direction.checked = true;
  direction.dispatchEvent(new Event('change', { bubbles: true }));
  katakana.checked = true;
  katakana.dispatchEvent(new Event('change', { bubbles: true }));
  expect(output.value).toBe('ガ😀\n');
  expect(outputCount.textContent).toBe('3文字 / 2行');

  copy.click();
  input.dispatchEvent(new Event('compositionstart', { bubbles: true }));
  expect(swap.disabled).toBe(true);
  swap.click();
  expect(input.value).toBe('ｶﾞ😀\n');
  input.dispatchEvent(new Event('compositionend', { bubbles: true }));
  expect(swap.disabled).toBe(false);
  swap.click();
  expect(input.value).toBe('ガ😀\n');
  expect(document.activeElement).toBe(input);
  expect(direction.checked).toBe(true);
  expect(katakana.checked).toBe(true);
  expect(output.value).toBe('ガ😀\n');
  expect(inputCount.textContent).toBe('3文字 / 2行');
  expect(outputCount.textContent).toBe('3文字 / 2行');
  finishCopy();
  await Promise.resolve();
  expect(status.textContent).toBe('');

  document.querySelector<HTMLButtonElement>('[data-clear]')!.click();
  expect(inputCount.textContent).toBe('0文字 / 0行');
  expect(outputCount.textContent).toBe('0文字 / 0行');
  expect(swap.disabled).toBe(true);
});
